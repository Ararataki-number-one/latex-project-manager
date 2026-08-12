package com.zqy.latexviewer.data

import com.zqy.latexviewer.model.MobilePdfOutput
import com.zqy.latexviewer.model.MobileProjectIndex
import com.zqy.latexviewer.model.ProjectResearchItem
import com.zqy.latexviewer.model.ResearchAttachment
import com.zqy.latexviewer.model.ResearchAttachmentAvailability
import com.zqy.latexviewer.model.ResearchRole
import com.zqy.latexviewer.model.TargetResearchLink
import org.json.JSONArray
import org.json.JSONObject

/**
 * The single Android codec for the portable project index. Network and Room
 * cache paths must both use this implementation so v3 research metadata is
 * never silently discarded after the first refresh.
 */
internal object MobileIndexCodec {
    private val hashPattern = Regex("^[a-fA-F0-9]{40,64}$")
    private val sha256Pattern = Regex("^[a-fA-F0-9]{64}$")
    private val windowsDrive = Regex("^[A-Za-z]:.*")

    fun decode(raw: String, commitSha: String? = null): MobileProjectIndex? =
        decodeInternal(raw, commitSha, allowLegacyV2Cache = false)

    /** Upgrade-only reader for 0.11.x caches that labelled payloads v2 before
     * immutable output metadata was available. Network payloads stay strict. */
    fun decodeCached(raw: String, commitSha: String? = null): MobileProjectIndex? =
        decodeInternal(raw, commitSha, allowLegacyV2Cache = true)

    private fun decodeInternal(
        raw: String,
        commitSha: String?,
        allowLegacyV2Cache: Boolean
    ): MobileProjectIndex? = runCatching {
        val value = JSONObject(raw)
        val schemaVersion = value.optInt("schemaVersion", 1)
        if (schemaVersion !in 1..3) return@runCatching null
        val projectId = value.optString("projectId", value.optString("id")).trim()
        val displayName = value.optString("name", value.optString("displayName")).trim()
        val updatedAt = value.optString("updatedAt").trim()
        val defaultOutputId = value.optionalString("defaultOutputId")
            ?: value.optionalString("defaultPdfId")
        if (projectId.isEmpty() || displayName.isEmpty() || updatedAt.isEmpty()) return@runCatching null
        if (schemaVersion < 3 && defaultOutputId == null) return@runCatching null

        val rawOutputs = value.optJSONArray("outputs") ?: value.optJSONArray("pdfOutputs")
            ?: return@runCatching null
        val outputs = buildList {
            for (index in 0 until rawOutputs.length()) {
                val output = rawOutputs.optJSONObject(index) ?: return@runCatching null
                val rawPdfPath = output.optString("pdfPath", output.optString("path")).trim()
                val rawEntry = output.optString("entry").trim()
                if (!isSafePdfPath(rawPdfPath) || !isSafeRelativePath(rawEntry)) return@runCatching null
                val pdfPath = normalizePath(rawPdfPath)
                val blobSha = output.optionalString("blobSha")
                val size = output.optionalLong("size")
                val generatedAt = output.optionalString("generatedAt")
                val parsed = MobilePdfOutput(
                    id = output.optString("id").trim().ifBlank { "output-$index" },
                    targetId = output.optString("targetId", output.optString("target")).trim().ifBlank { "default" },
                    name = output.optString("name").trim().ifBlank { pdfPath.substringAfterLast('/') },
                    entry = normalizePath(rawEntry),
                    profileId = output.optionalString("profileId"),
                    pdfPath = pdfPath,
                    blobSha = blobSha,
                    size = size,
                    generatedAt = generatedAt
                )
                if (parsed.id.isEmpty() || parsed.targetId.isEmpty() || parsed.name.isEmpty() || !isSafePdfPath(pdfPath)) {
                    return@runCatching null
                }
                if (schemaVersion >= 2 && !allowLegacyV2Cache &&
                    (blobSha?.matches(hashPattern) != true || size == null || size < 0L || generatedAt.isNullOrBlank())) {
                    return@runCatching null
                }
                add(parsed)
            }
        }
        if ((schemaVersion < 3 && outputs.isEmpty()) || outputs.map(MobilePdfOutput::id).distinct().size != outputs.size
            || (defaultOutputId != null && outputs.none { it.id == defaultOutputId })
            || (schemaVersion == 3 && outputs.isNotEmpty() && defaultOutputId == null)
        ) {
            return@runCatching null
        }

        val researchItems = if (schemaVersion >= 3) {
            val array = value.optJSONArray("researchItems") ?: return@runCatching null
            decodeResearchItems(array) ?: return@runCatching null
        } else {
            emptyList()
        }
        if (researchItems.map(ProjectResearchItem::id).distinct().size != researchItems.size) return@runCatching null

        MobileProjectIndex(
            schemaVersion = schemaVersion,
            projectId = projectId,
            name = displayName,
            updatedAt = updatedAt,
            defaultOutputId = defaultOutputId,
            outputs = outputs,
            researchItems = researchItems,
            commitSha = commitSha ?: value.optionalString("commitSha")
        )
    }.getOrNull()

    fun encode(index: MobileProjectIndex): String {
        val outputs = JSONArray()
        index.outputs.forEach { output ->
            outputs.put(JSONObject().apply {
                put("id", output.id)
                put("targetId", output.targetId)
                put("name", output.name)
                put("entry", normalizePath(output.entry))
                output.profileId?.let { put("profileId", it) }
                put("pdfPath", normalizePath(output.pdfPath))
                output.blobSha?.let { put("blobSha", it) }
                output.size?.let { put("size", it) }
                output.generatedAt?.let { put("generatedAt", it) }
            })
        }
        return JSONObject().apply {
            put("schemaVersion", index.schemaVersion)
            put("projectId", index.projectId)
            put("name", index.name)
            put("updatedAt", index.updatedAt)
            index.defaultOutputId?.let { put("defaultOutputId", it) }
            put("outputs", outputs)
            if (index.schemaVersion >= 3) put("researchItems", encodeResearchItems(index.researchItems))
            index.commitSha?.let { put("commitSha", it) }
        }.toString()
    }

    private fun decodeResearchItems(values: JSONArray): List<ProjectResearchItem>? = buildList {
        for (index in 0 until values.length()) {
            val value = values.optJSONObject(index) ?: return null
            val id = value.optString("id").trim()
            if (id.isEmpty()) return null
            val authors = value.optJSONArray("authors")?.strings() ?: emptyList()
            val attachmentsValue = value.optJSONArray("attachments") ?: return null
            val attachments = buildList {
                for (attachmentIndex in 0 until attachmentsValue.length()) {
                    val attachment = attachmentsValue.optJSONObject(attachmentIndex) ?: return null
                    val availability = ResearchAttachmentAvailability.fromWireValue(attachment.optString("availability")) ?: return null
                    val rawRelativePath = attachment.optionalString("relativePath")
                    if (rawRelativePath != null && !isSafeRelativePath(rawRelativePath)) return null
                    val relativePath = rawRelativePath?.let(::normalizePath)
                    val size = attachment.optionalLong("size")
                    val sha256 = attachment.optionalString("sha256")
                    val gitBlobSha = attachment.optionalString("gitBlobSha")
                    if (availability == ResearchAttachmentAvailability.REPOSITORY && !isSafeRelativePath(relativePath.orEmpty())) return null
                    if (availability == ResearchAttachmentAvailability.LOCAL_ONLY && (relativePath != null || gitBlobSha != null)) return null
                    if (size != null && size < 0L) return null
                    if (sha256 != null && !sha256.matches(sha256Pattern)) return null
                    if (gitBlobSha != null && !gitBlobSha.matches(hashPattern)) return null
                    add(
                        ResearchAttachment(
                            id = attachment.optString("id").trim().ifBlank { return null },
                            name = attachment.optString("name").trim().ifBlank { return null },
                            relativePath = relativePath,
                            mediaType = attachment.optString("mediaType", "application/octet-stream").trim(),
                            size = size,
                            sha256 = sha256,
                            gitBlobSha = gitBlobSha,
                            versionLabel = attachment.optionalString("versionLabel"),
                            availability = availability
                        )
                    )
                }
            }
            if (attachments.map(ResearchAttachment::id).distinct().size != attachments.size) return null
            val linksValue = value.optJSONArray("links") ?: return null
            val links = buildList {
                for (linkIndex in 0 until linksValue.length()) {
                    val link = linksValue.optJSONObject(linkIndex) ?: return null
                    val targetId = link.optionalString("targetId")
                    val role = ResearchRole.fromWireValue(link.optString("role")) ?: return null
                    val preferred = link.optionalString("preferredAttachmentId")
                    if (preferred != null && attachments.none { it.id == preferred }) return null
                    add(TargetResearchLink(targetId, role, preferred))
                }
            }
            val year = value.optionalInt("year")
            if (year != null && year !in 1000..9999) return null
            add(
                ProjectResearchItem(
                    id = id,
                    title = value.optionalString("title"),
                    authors = authors,
                    year = year,
                    language = value.optionalString("language"),
                    doi = value.optionalString("doi"),
                    arxivId = value.optionalString("arxivId"),
                    isbn = value.optionalString("isbn"),
                    attachments = attachments,
                    links = links,
                    sortOrder = value.optInt("sortOrder", index)
                )
            )
        }
    }

    private fun encodeResearchItems(items: List<ProjectResearchItem>): JSONArray = JSONArray().apply {
        items.sortedBy(ProjectResearchItem::sortOrder).forEach { item ->
            put(JSONObject().apply {
                put("id", item.id)
                item.title?.let { put("title", it) }
                put("authors", JSONArray(item.authors))
                item.year?.let { put("year", it) }
                item.language?.let { put("language", it) }
                item.doi?.let { put("doi", it) }
                item.arxivId?.let { put("arxivId", it) }
                item.isbn?.let { put("isbn", it) }
                put("sortOrder", item.sortOrder)
                put("attachments", JSONArray().apply {
                    item.attachments.forEach { attachment ->
                        put(JSONObject().apply {
                            put("id", attachment.id)
                            put("name", attachment.name)
                            attachment.relativePath?.let { put("relativePath", normalizePath(it)) }
                            put("mediaType", attachment.mediaType)
                            attachment.size?.let { put("size", it) }
                            attachment.sha256?.let { put("sha256", it) }
                            attachment.gitBlobSha?.let { put("gitBlobSha", it) }
                            attachment.versionLabel?.let { put("versionLabel", it) }
                            put("availability", attachment.availability.wireValue)
                        })
                    }
                })
                put("links", JSONArray().apply {
                    item.links.forEach { link ->
                        put(JSONObject().apply {
                            if (link.targetId == null) put("targetId", JSONObject.NULL) else put("targetId", link.targetId)
                            put("role", link.role.wireValue)
                            link.preferredAttachmentId?.let { put("preferredAttachmentId", it) }
                        })
                    }
                })
            })
        }
    }

    fun isSafePdfPath(path: String): Boolean = isSafeRelativePath(path) && path.endsWith(".pdf", ignoreCase = true)

    fun isSafeRelativePath(path: String): Boolean {
        if (path.isBlank() || path.startsWith('/') || path.startsWith('\\') || windowsDrive.matches(path)) return false
        return path.replace('\\', '/').split('/').none { it.isBlank() || it == "." || it == ".." }
    }

    fun normalizePath(path: String): String = path.replace('\\', '/').trimStart('/')

    private fun JSONObject.optionalString(name: String): String? =
        if (!has(name) || isNull(name)) null else optString(name).trim().takeIf(String::isNotEmpty)

    private fun JSONObject.optionalLong(name: String): Long? =
        if (!has(name) || isNull(name)) null else optLong(name)

    private fun JSONObject.optionalInt(name: String): Int? =
        if (!has(name) || isNull(name)) null else optInt(name)

    private fun JSONArray.strings(): List<String> = buildList {
        for (index in 0 until length()) {
            val value = optString(index).trim()
            if (value.isNotEmpty()) add(value)
        }
    }
}
