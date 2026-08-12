package com.zqy.latexviewer.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.zqy.latexviewer.ui.theme.AppElevation
import com.zqy.latexviewer.ui.theme.AppRadius
import com.zqy.latexviewer.ui.theme.AppSize

/**
 * Transparent page title used by root destinations. The system status bar is
 * intentionally not reproduced inside the app.
 */
@Composable
internal fun TexFlowRootHeader(
    title: String,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {}
) {
    PaperRootHeader(title = title, modifier = modifier, actions = actions)
}

/** A quiet serif heading that keeps the v8 vertical alignment between pages. */
@Composable
internal fun TexFlowSectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    trailing: @Composable RowScope.() -> Unit = {}
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = 18.dp, bottom = 9.dp)
            .semantics { heading() },
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = title,
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.onSurface,
            style = MaterialTheme.typography.titleMedium.copy(
                fontFamily = FontFamily.Serif,
                fontSize = 18.sp,
                lineHeight = 24.sp,
                fontWeight = FontWeight.Bold
            ),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Row(
            modifier = Modifier.heightIn(min = AppSize.minimumTouchTarget),
            verticalAlignment = Alignment.CenterVertically,
            content = trailing
        )
    }
}

/**
 * One paper-like group for settings, completed downloads, or recent items.
 * Rows inside the group own their touch semantics; this container is visual.
 */
@Composable
internal fun TexFlowGroupedSurface(
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    content: @Composable ColumnScope.() -> Unit
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(AppRadius.group),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        shadowElevation = AppElevation.row,
        tonalElevation = 0.dp
    ) {
        Column(
            modifier = Modifier.padding(contentPadding),
            content = content
        )
    }
}

@Composable
internal fun TexFlowGroupDivider(
    modifier: Modifier = Modifier,
    startInset: androidx.compose.ui.unit.Dp = 0.dp
) {
    HorizontalDivider(
        modifier = modifier.padding(start = startInset),
        thickness = 1.dp,
        color = MaterialTheme.colorScheme.outlineVariant
    )
}

/** A real 48 dp filter target; the HTML's smaller chip is only a visual cue. */
@Composable
internal fun TexFlowFilterChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true
) {
    val shape = RoundedCornerShape(13.dp)
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = AppSize.minimumTouchTarget),
        shape = shape,
        color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
        contentColor = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(
            1.dp,
            if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
        ),
        tonalElevation = 0.dp,
        shadowElevation = 0.dp
    ) {
        Box(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                maxLines = 1
            )
        }
    }
}

/** Independent project card used by the project-library stack. */
@Composable
internal fun TexFlowProjectRow(
    title: String,
    metadata: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    trailing: @Composable RowScope.() -> Unit = {}
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = AppSize.projectRow)
            .semantics(mergeDescendants = true) {},
        shape = RoundedCornerShape(AppRadius.row),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        shadowElevation = AppElevation.row,
        tonalElevation = 0.dp
    ) {
        Row(
            modifier = Modifier.padding(start = 11.dp, end = 5.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                modifier = Modifier.size(AppSize.listIconContainer),
                shape = RoundedCornerShape(11.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                tonalElevation = 0.dp,
                shadowElevation = 0.dp
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Outlined.Folder,
                        contentDescription = null,
                        modifier = Modifier.size(AppSize.listIcon),
                        tint = MaterialTheme.colorScheme.onSurface
                    )
                }
            }
            Spacer(Modifier.width(13.dp))
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium.copy(fontFamily = FontFamily.Serif),
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = metadata,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Row(
                modifier = Modifier.heightIn(min = AppSize.minimumTouchTarget),
                verticalAlignment = Alignment.CenterVertically,
                content = trailing
            )
        }
    }
}

/** Compact outlined file row. File operations remain supplied by the caller. */
@Composable
internal fun TexFlowFileRow(
    name: String,
    metadata: String,
    type: PaperFileType,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    selected: Boolean = false,
    trailing: @Composable RowScope.() -> Unit = {}
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = AppSize.listRowCompact)
            .semantics(mergeDescendants = true) {},
        shape = RoundedCornerShape(11.dp),
        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(
            1.dp,
            if (selected) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.outlineVariant
        ),
        tonalElevation = 0.dp,
        shadowElevation = 0.dp
    ) {
        Row(
            modifier = Modifier.padding(start = 9.dp, end = 4.dp, top = 5.dp, bottom = 5.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier.size(32.dp),
                contentAlignment = Alignment.Center
            ) {
                PaperFileTypeIcon(type = type, size = 22.dp)
            }
            Spacer(Modifier.width(11.dp))
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(1.dp)
            ) {
                Text(
                    text = name,
                    style = MaterialTheme.typography.titleMedium.copy(fontFamily = FontFamily.Serif),
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = metadata,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Row(
                modifier = Modifier.heightIn(min = AppSize.minimumTouchTarget),
                verticalAlignment = Alignment.CenterVertically,
                content = trailing
            )
        }
    }
}

/** Semantic status pill. Success is the only state that uses green. */
@Composable
internal fun TexFlowStatusBadge(
    text: String,
    modifier: Modifier = Modifier,
    success: Boolean = false
) {
    val background = if (success) {
        MaterialTheme.colorScheme.secondaryContainer
    } else {
        MaterialTheme.colorScheme.surfaceVariant
    }
    val foreground = if (success) {
        MaterialTheme.colorScheme.onSecondaryContainer
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(AppRadius.pill),
        color = background,
        contentColor = foreground,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        tonalElevation = 0.dp,
        shadowElevation = 0.dp
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
            color = foreground,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1
        )
    }
}
