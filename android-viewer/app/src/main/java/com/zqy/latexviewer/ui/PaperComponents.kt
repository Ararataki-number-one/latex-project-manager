package com.zqy.latexviewer.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Clear
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SystemUpdateAlt
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Root-screen header for the Paper Library visual language. */
@Composable
internal fun PaperRootHeader(
    title: String,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {}
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .padding(start = 20.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = title,
            modifier = Modifier
                .weight(1f)
                .semantics { heading() },
            color = MaterialTheme.colorScheme.onBackground,
            style = MaterialTheme.typography.headlineLarge,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )
        Row(
            modifier = Modifier.heightIn(min = 48.dp),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
            content = actions
        )
    }
}

/** Quiet section label used above flat lists rather than another card. */
@Composable
internal fun PaperSectionHeader(
    title: String,
    modifier: Modifier = Modifier
) {
    Text(
        text = title,
        modifier = modifier
            .fillMaxWidth()
            .padding(top = 16.dp, bottom = 8.dp)
            .semantics { heading() },
        color = MaterialTheme.colorScheme.onSurface,
        style = MaterialTheme.typography.titleSmall,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis
    )
}

/** A 48 dp filled search field with no persistent Material outline. */
@Composable
internal fun PaperSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onSearch: (() -> Unit)? = null
) {
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .alpha(if (enabled) 1f else 0.5f),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(48.dp),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Outlined.Search,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .semantics {
                        contentDescription = placeholder
                        if (!enabled) disabled()
                    },
                enabled = enabled,
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge.copy(
                    color = MaterialTheme.colorScheme.onSurface
                ),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { onSearch?.invoke() }),
                decorationBox = { innerTextField ->
                    Box(
                        modifier = Modifier.fillMaxHeight(),
                        contentAlignment = Alignment.CenterStart
                    ) {
                        if (value.isEmpty()) {
                            Text(
                                text = placeholder,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodyLarge,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                        innerTextField()
                    }
                }
            )
            if (value.isNotEmpty()) {
                IconButton(
                    onClick = { onValueChange("") },
                    enabled = enabled,
                    modifier = Modifier.size(48.dp)
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Clear,
                        contentDescription = "清除搜索",
                        modifier = Modifier.size(19.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                Spacer(Modifier.width(12.dp))
            }
        }
    }
}

/** Contextual empty state with at most one next-step action. */
@Composable
internal fun PaperEmptyState(
    title: String,
    detail: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 28.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(40.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(18.dp))
        Text(
            text = title,
            modifier = Modifier.semantics { heading() },
            color = MaterialTheme.colorScheme.onSurface,
            style = MaterialTheme.typography.titleLarge,
            textAlign = TextAlign.Center
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = detail,
            modifier = Modifier.widthIn(max = 300.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center
        )
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(22.dp))
            Button(
                onClick = onAction,
                modifier = Modifier
                    .height(48.dp)
                    .widthIn(min = 128.dp)
            ) {
                Text(actionLabel)
            }
        }
    }
}

/**
 * Three-destination bottom bar without Material's selected-item capsule.
 * The full third item remains a 68 dp tap target while the small status dot
 * communicates that a background download is active.
 */
@Composable
internal fun PaperBottomBar(
    selected: String,
    downloadActive: Boolean,
    onHome: () -> Unit,
    onProjects: () -> Unit,
    onDownloads: () -> Unit,
    modifier: Modifier = Modifier
) {
    val selectedKey = when (selected.lowercase()) {
        "home", "read", "reading" -> PAPER_HOME
        "project", "projects", "repository", "repositories" -> PAPER_PROJECTS
        "download", "downloads" -> PAPER_DOWNLOADS
        else -> ""
    }
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = 0.dp,
        shadowElevation = 0.dp
    ) {
        Column(modifier = Modifier.navigationBarsPadding()) {
            HorizontalDivider(
                thickness = 1.dp,
                color = MaterialTheme.colorScheme.outlineVariant
            )
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(68.dp)
            ) {
                PaperBottomItem(
                    label = "阅读",
                    icon = Icons.Outlined.Home,
                    selected = selectedKey == PAPER_HOME,
                    onClick = onHome
                )
                PaperBottomItem(
                    label = "项目",
                    icon = Icons.Outlined.Folder,
                    selected = selectedKey == PAPER_PROJECTS,
                    onClick = onProjects
                )
                PaperBottomItem(
                    label = "下载",
                    icon = Icons.Outlined.Download,
                    selected = selectedKey == PAPER_DOWNLOADS,
                    statusActive = downloadActive,
                    onClick = onDownloads
                )
            }
        }
    }
}

@Composable
internal fun PaperBottomBar(
    selected: ViewerScreen,
    downloadActive: Boolean,
    onHome: () -> Unit,
    onProjects: () -> Unit,
    onDownloads: () -> Unit,
    modifier: Modifier = Modifier
) {
    PaperBottomBar(
        selected = when (selected) {
            ViewerScreen.HOME -> PAPER_HOME
            ViewerScreen.REPOSITORIES -> PAPER_PROJECTS
            ViewerScreen.DOWNLOADS -> PAPER_DOWNLOADS
            else -> ""
        },
        downloadActive = downloadActive,
        onHome = onHome,
        onProjects = onProjects,
        onDownloads = onDownloads,
        modifier = modifier
    )
}

@Composable
private fun RowScope.PaperBottomItem(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    onClick: () -> Unit,
    statusActive: Boolean = false
) {
    Box(
        modifier = Modifier
            .weight(1f)
            .fillMaxHeight()
            .semantics(mergeDescendants = true) {}
            .selectable(
                selected = selected,
                onClick = onClick,
                role = Role.Tab
            ),
        contentAlignment = Alignment.Center
    ) {
        Box(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .width(24.dp)
                .height(2.dp)
                .background(
                    color = if (selected) MaterialTheme.colorScheme.onSurface else Color.Transparent,
                    shape = RoundedCornerShape(bottomStart = 2.dp, bottomEnd = 2.dp)
                )
        )
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                modifier = Modifier.size(28.dp),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    modifier = Modifier.size(22.dp),
                    tint = if (selected) {
                        MaterialTheme.colorScheme.onSurface
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    }
                )
                if (statusActive) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .size(7.dp)
                            .semantics {
                                contentDescription = "正在下载"
                            }
                            .background(
                                color = MaterialTheme.colorScheme.secondary,
                                shape = RoundedCornerShape(999.dp)
                            )
                    )
                }
            }
            Spacer(Modifier.height(3.dp))
            Text(
                text = label,
                color = if (selected) {
                    MaterialTheme.colorScheme.onSurface
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                style = MaterialTheme.typography.labelSmall,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                maxLines = 1
            )
        }
    }
}

internal enum class PaperFileType {
    FOLDER,
    PDF,
    SOURCE,
    ARCHIVE,
    APP,
    FILE
}

/** File-type glyph without a tile or other decorative background. */
@Composable
internal fun PaperFileTypeIcon(
    type: PaperFileType,
    modifier: Modifier = Modifier,
    size: Dp = 22.dp,
    contentDescription: String? = null,
    tint: Color? = null
) {
    Icon(
        imageVector = when (type) {
            PaperFileType.FOLDER -> Icons.Outlined.Folder
            PaperFileType.PDF -> Icons.Outlined.PictureAsPdf
            PaperFileType.SOURCE -> Icons.Outlined.Code
            PaperFileType.ARCHIVE -> Icons.Outlined.Archive
            PaperFileType.APP -> Icons.Outlined.SystemUpdateAlt
            PaperFileType.FILE -> Icons.Outlined.Description
        },
        contentDescription = contentDescription,
        modifier = modifier.size(size),
        tint = tint ?: if (type == PaperFileType.FOLDER) {
            MaterialTheme.colorScheme.onSurface
        } else {
            MaterialTheme.colorScheme.onSurfaceVariant
        }
    )
}

internal fun paperFileType(name: String, isDirectory: Boolean = false): PaperFileType {
    if (isDirectory) return PaperFileType.FOLDER
    return when (name.substringAfterLast('.', "").lowercase()) {
        "pdf" -> PaperFileType.PDF
        "tex", "bib", "cls", "sty", "bst", "md", "txt", "json", "yaml", "yml",
        "toml", "xml", "kt", "java", "c", "h", "cpp", "hpp", "py", "r", "m", "js",
        "jsx", "ts", "tsx", "css", "html", "sh", "ps1", "bat", "cmd" -> PaperFileType.SOURCE
        "zip", "rar", "7z", "tar", "gz", "bz2", "xz" -> PaperFileType.ARCHIVE
        "apk" -> PaperFileType.APP
        else -> PaperFileType.FILE
    }
}

private const val PAPER_HOME = "home"
private const val PAPER_PROJECTS = "projects"
private const val PAPER_DOWNLOADS = "downloads"
