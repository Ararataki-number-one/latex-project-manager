package com.zqy.latexviewer.data

import com.zqy.latexviewer.model.ResearchAttachmentAvailability
import com.zqy.latexviewer.model.ResearchRole
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MobileIndexCodecTest {
    @Test
    fun `v2 immutable output metadata survives room round trip`() {
        val raw = """
            {
              "schemaVersion": 2,
              "projectId": "project-1",
              "name": "Graph notes",
              "updatedAt": "2026-08-12T10:00:00.000Z",
              "defaultOutputId": "main-pdf",
              "outputs": [{
                "id": "main-pdf",
                "targetId": "book",
                "name": "Graph notes",
                "entry": "main.tex",
                "pdfPath": "main.pdf",
                "blobSha": "1111111111111111111111111111111111111111",
                "size": 1234,
                "generatedAt": "2026-08-12T09:00:00.000Z"
              }]
            }
        """.trimIndent()

        val decoded = requireNotNull(MobileIndexCodec.decode(raw, "commit-1"))
        val output = decoded.outputs.single()
        assertEquals("1111111111111111111111111111111111111111", output.blobSha)
        assertEquals(1234L, output.size)
        assertEquals("2026-08-12T09:00:00.000Z", output.generatedAt)

        val restored = requireNotNull(MobileIndexCodec.decode(MobileIndexCodec.encode(decoded)))
        assertEquals(output, restored.outputs.single())
    }

    @Test
    fun `v3 supports a research-only project and preserves privacy boundary`() {
        val raw = """
            {
              "schemaVersion": 3,
              "projectId": "project-1",
              "name": "Graph notes",
              "updatedAt": "2026-08-12T10:00:00.000Z",
              "outputs": [],
              "researchItems": [{
                "id": "paper-1",
                "title": "A theorem",
                "authors": ["A. Author"],
                "year": 2025,
                "sortOrder": 0,
                "attachments": [
                  {
                    "id": "public-pdf",
                    "name": "paper.pdf",
                    "relativePath": "references/paper.pdf",
                    "mediaType": "application/pdf",
                    "size": 99,
                    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "gitBlobSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    "availability": "repository"
                  },
                  {
                    "id": "private-copy",
                    "name": "licensed.pdf",
                    "mediaType": "application/pdf",
                    "availability": "localOnly"
                  }
                ],
                "links": [{"targetId": null, "role": "primarySource", "preferredAttachmentId": "public-pdf"}]
              }]
            }
        """.trimIndent()

        val decoded = requireNotNull(MobileIndexCodec.decode(raw))
        assertNull(decoded.defaultOutputId)
        assertEquals(0, decoded.outputs.size)
        assertEquals(ResearchRole.PRIMARY_SOURCE, decoded.researchItems.single().links.single().role)
        assertEquals(
            ResearchAttachmentAvailability.LOCAL_ONLY,
            decoded.researchItems.single().attachments.last().availability
        )

        val restored = requireNotNull(MobileIndexCodec.decode(MobileIndexCodec.encode(decoded)))
        assertEquals(decoded.researchItems, restored.researchItems)
    }

    @Test
    fun `v3 rejects traversal and local-only path disclosure`() {
        val traversal = v3Attachment("repository", "../secret.pdf")
        val absolute = v3Attachment("repository", "/secret.pdf")
        val unc = v3Attachment("repository", "\\\\server\\share.pdf")
        val disclosedLocalPath = v3Attachment("localOnly", "references/licensed.pdf")

        assertNull(MobileIndexCodec.decode(traversal))
        assertNull(MobileIndexCodec.decode(absolute))
        assertNull(MobileIndexCodec.decode(unc))
        assertNull(MobileIndexCodec.decode(disclosedLocalPath))
    }

    @Test
    fun `v3 with outputs requires a default while pending research may have no link`() {
        val outputWithoutDefault = """
            {
              "schemaVersion": 3,
              "projectId": "project-1",
              "name": "Project",
              "updatedAt": "2026-08-12T10:00:00.000Z",
              "outputs": [{
                "id": "main",
                "targetId": "book",
                "name": "Main",
                "entry": "main.tex",
                "pdfPath": "main.pdf",
                "blobSha": "1111111111111111111111111111111111111111",
                "size": 12,
                "generatedAt": "2026-08-12T09:00:00.000Z"
              }],
              "researchItems": []
            }
        """.trimIndent()
        val itemWithoutLink = v3Attachment("repository", "references/paper.pdf")
            .replace("\"links\": [{\"targetId\": null, \"role\": \"reference\"}]", "\"links\": []")

        assertNull(MobileIndexCodec.decode(outputWithoutDefault))
        assertEquals(emptyList<com.zqy.latexviewer.model.TargetResearchLink>(), requireNotNull(MobileIndexCodec.decode(itemWithoutLink)).researchItems.single().links)
    }

    @Test
    fun `legacy v2 cache remains readable without weakening network validation`() {
        val legacy = """
            {
              "schemaVersion": 2,
              "projectId": "project-1",
              "name": "Legacy cache",
              "updatedAt": "2026-08-01T10:00:00.000Z",
              "defaultOutputId": "main",
              "outputs": [{
                "id": "main",
                "targetId": "book",
                "name": "Main",
                "entry": "main.tex",
                "pdfPath": "main.pdf"
              }]
            }
        """.trimIndent()

        assertNull(MobileIndexCodec.decode(legacy))
        val cached = requireNotNull(MobileIndexCodec.decodeCached(legacy, "cached-commit"))
        assertEquals("main.pdf", cached.defaultOutput?.pdfPath)
        assertEquals("cached-commit", cached.commitSha)
    }

    @Test
    fun `shared desktop and Android v3 contract fixtures agree`() {
        val valid = requireNotNull(MobileIndexCodec.decode(fixture("v3-valid.json")))
        assertEquals(3, valid.schemaVersion)
        assertEquals("project-contract", valid.projectId)
        assertEquals("attachment-pdf", valid.researchItems.single().links.single().preferredAttachmentId)
        assertNull(MobileIndexCodec.decode(fixture("v3-invalid-path.json")))
    }

    private fun fixture(name: String): String = requireNotNull(
        javaClass.classLoader?.getResourceAsStream("mobile-index/$name")
    ) { "Missing shared mobile-index fixture: $name" }
        .bufferedReader(Charsets.UTF_8)
        .use { it.readText() }

    private fun v3Attachment(availability: String, relativePath: String): String = """
        {
          "schemaVersion": 3,
          "projectId": "project-1",
          "name": "Project",
          "updatedAt": "2026-08-12T10:00:00.000Z",
          "outputs": [],
          "researchItems": [{
            "id": "item-1",
            "authors": [],
            "attachments": [{
              "id": "attachment-1",
              "name": "paper.pdf",
              "relativePath": "$relativePath",
              "mediaType": "application/pdf",
              "availability": "$availability"
            }],
            "links": [{"targetId": null, "role": "reference"}]
          }]
        }
    """.trimIndent()
}
