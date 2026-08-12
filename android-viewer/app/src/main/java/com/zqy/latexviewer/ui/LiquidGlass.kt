package com.zqy.latexviewer.ui

import android.app.ActivityManager
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.zqy.latexviewer.model.GlassMode
import dev.chrisbanes.haze.HazeInputScale
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.HazeStyle
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.hazeEffect
import dev.chrisbanes.haze.hazeSource

/**
 * Marks content as the backdrop source for one or more liquid-glass controls.
 * A nullable state keeps previews and screens without a floating material layer
 * on the inexpensive opaque path.
 */
internal typealias LiquidGlassMode = GlassMode

internal val LocalLiquidGlassMode = staticCompositionLocalOf { LiquidGlassMode.AUTO }

@Composable
internal fun Modifier.liquidGlassSource(hazeState: HazeState?): Modifier =
    if (hazeState == null || LocalLiquidGlassMode.current == LiquidGlassMode.OFF) {
        this
    } else {
        hazeSource(state = hazeState)
    }

/**
 * Applies a true backdrop effect when a shared [hazeState] is supplied.
 *
 * Android 12+ devices render the captured backdrop through Haze. Older and
 * low-RAM devices, callers that disable the effect, and callers without a
 * source state receive an opaque, high-contrast material instead. Child
 * content is drawn after the effect and therefore remains crisp.
 */
@Composable
internal fun Modifier.liquidGlass(
    shape: Shape = RoundedCornerShape(22.dp),
    elevation: Dp = 8.dp,
    hazeState: HazeState? = null,
    backdropBlurEnabled: Boolean = true
): Modifier {
    val colors = MaterialTheme.colorScheme
    val dark = colors.background.luminance() < 0.5f
    val context = LocalContext.current
    val glassMode = LocalLiquidGlassMode.current
    val lowRamDevice = remember(context) {
        context.getSystemService(ActivityManager::class.java)?.isLowRamDevice == true
    }
    val canBlurBackdrop = hazeState != null &&
        backdropBlurEnabled &&
        glassMode != LiquidGlassMode.OFF &&
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        (glassMode == LiquidGlassMode.FULL || !lowRamDevice)

    val backdropTint = if (dark) {
        Color(0xFF1C1C1E).copy(alpha = 0.66f)
    } else {
        Color.White.copy(alpha = 0.62f)
    }
    val opaqueFallback = if (dark) {
        Color(0xFF242426)
    } else {
        Color(0xFFF7F7F8)
    }
    val hazeStyle = HazeStyle(
        backgroundColor = colors.surface,
        tint = HazeTint(backdropTint),
        blurRadius = 24.dp,
        noiseFactor = if (dark) 0.035f else 0.025f,
        fallbackTint = HazeTint(opaqueFallback)
    )
    val highlightBorder = Brush.linearGradient(
        colors = if (dark) {
            listOf(
                Color.White.copy(alpha = 0.28f),
                colors.outline.copy(alpha = 0.34f),
                Color.Black.copy(alpha = 0.22f)
            )
        } else {
            listOf(
                Color.White.copy(alpha = 0.96f),
                colors.outlineVariant.copy(alpha = 0.72f),
                colors.outline.copy(alpha = 0.24f)
            )
        }
    )

    val clippedSurface = this
        .shadow(elevation = elevation, shape = shape, clip = false)
        .clip(shape)

    val materialSurface = if (hazeState != null && glassMode != LiquidGlassMode.OFF) {
        clippedSurface.hazeEffect(
            state = hazeState,
            style = hazeStyle
        ) {
            blurEnabled = canBlurBackdrop
            inputScale = HazeInputScale.Fixed(0.5f)
        }
    } else {
        clippedSurface.background(color = opaqueFallback, shape = shape)
    }

    return materialSurface
        .border(width = 1.dp, brush = highlightBorder, shape = shape)
}

/**
 * Reusable glass container. When [onClick] is supplied the complete surface is
 * a native-ripple target of at least 48 dp; otherwise it remains presentational.
 */
@Composable
internal fun LiquidGlassSurface(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(22.dp),
    elevation: Dp = 8.dp,
    enabled: Boolean = true,
    onClick: (() -> Unit)? = null,
    onClickLabel: String? = null,
    role: Role? = null,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    contentAlignment: Alignment = Alignment.CenterStart,
    hazeState: HazeState? = null,
    backdropBlurEnabled: Boolean = true,
    content: @Composable BoxScope.() -> Unit
) {
    val colors = MaterialTheme.colorScheme
    val dark = colors.background.luminance() < 0.5f
    val sheen = Brush.verticalGradient(
        colors = if (dark) {
            listOf(
                Color.White.copy(alpha = 0.10f),
                Color.Transparent,
                Color.Black.copy(alpha = 0.08f)
            )
        } else {
            listOf(
                Color.White.copy(alpha = 0.24f),
                Color.Transparent,
                Color.Black.copy(alpha = 0.025f)
            )
        }
    )
    val clickModifier = if (onClick != null) {
        Modifier.clickable(
            enabled = enabled,
            onClickLabel = onClickLabel,
            role = role,
            onClick = onClick
        )
    } else {
        Modifier
    }

    Box(
        modifier = modifier
            .defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)
            .liquidGlass(
                shape = shape,
                elevation = elevation,
                hazeState = hazeState,
                backdropBlurEnabled = backdropBlurEnabled
            )
            .then(clickModifier),
        contentAlignment = contentAlignment
    ) {
        // Draw the sheen behind content so text and icons stay crisp.
        Box(
            modifier = Modifier
                .matchParentSize()
                .background(sheen)
        )
        CompositionLocalProvider(LocalContentColor provides colors.onSurface) {
            Box(
                modifier = Modifier
                    .matchParentSize()
                    .padding(contentPadding),
                contentAlignment = contentAlignment,
                content = content
            )
        }
    }
}

/** Floating, left-aligned glass top bar with a built-in 48 dp navigation target. */
@Composable
internal fun LiquidGlassTopBar(
    title: String,
    modifier: Modifier = Modifier,
    navigationIcon: ImageVector? = null,
    navigationContentDescription: String = "返回",
    onNavigationClick: (() -> Unit)? = null,
    hazeState: HazeState? = null,
    backdropBlurEnabled: Boolean = true,
    actions: @Composable RowScope.() -> Unit = {}
) {
    LiquidGlassSurface(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp),
        shape = RoundedCornerShape(22.dp),
        elevation = 8.dp,
        contentPadding = PaddingValues(horizontal = 4.dp),
        hazeState = hazeState,
        backdropBlurEnabled = backdropBlurEnabled
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (navigationIcon != null && onNavigationClick != null) {
                IconButton(
                    onClick = onNavigationClick,
                    modifier = Modifier.size(48.dp)
                ) {
                    Icon(
                        imageVector = navigationIcon,
                        contentDescription = navigationContentDescription,
                        modifier = Modifier.size(22.dp)
                    )
                }
            } else {
                Box(modifier = Modifier.width(12.dp))
            }
            Text(
                text = title,
                modifier = Modifier
                    .weight(1f)
                    .semantics { heading() },
                color = MaterialTheme.colorScheme.onSurface,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Row(
                modifier = Modifier.heightIn(min = 48.dp),
                verticalAlignment = Alignment.CenterVertically,
                content = actions
            )
        }
    }
}

/** Three-destination floating glass bar with no Material selection capsule. */
@Composable
internal fun LiquidGlassBottomBar(
    selected: String,
    downloadActive: Boolean,
    onHome: () -> Unit,
    onProjects: () -> Unit,
    onDownloads: () -> Unit,
    modifier: Modifier = Modifier,
    hazeState: HazeState? = null,
    backdropBlurEnabled: Boolean = true
) {
    val selectedKey = when (selected.lowercase()) {
        "home", "read", "reading" -> LIQUID_HOME
        "project", "projects", "repository", "repositories" -> LIQUID_PROJECTS
        "download", "downloads" -> LIQUID_DOWNLOADS
        else -> ""
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        LiquidGlassSurface(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 64.dp),
            shape = RoundedCornerShape(26.dp),
            elevation = 10.dp,
            hazeState = hazeState,
            backdropBlurEnabled = backdropBlurEnabled
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .fillMaxHeight()
            ) {
                LiquidGlassBottomItem(
                    label = "阅读",
                    icon = Icons.Outlined.Home,
                    selected = selectedKey == LIQUID_HOME,
                    onClick = onHome
                )
                LiquidGlassBottomItem(
                    label = "项目",
                    icon = Icons.Outlined.Folder,
                    selected = selectedKey == LIQUID_PROJECTS,
                    onClick = onProjects
                )
                LiquidGlassBottomItem(
                    label = "下载",
                    icon = Icons.Outlined.Download,
                    selected = selectedKey == LIQUID_DOWNLOADS,
                    statusActive = downloadActive,
                    onClick = onDownloads
                )
            }
        }
    }
}

@Composable
internal fun LiquidGlassBottomBar(
    selected: ViewerScreen,
    downloadActive: Boolean,
    onHome: () -> Unit,
    onProjects: () -> Unit,
    onDownloads: () -> Unit,
    modifier: Modifier = Modifier,
    hazeState: HazeState? = null,
    backdropBlurEnabled: Boolean = true
) {
    LiquidGlassBottomBar(
        selected = when (selected) {
            ViewerScreen.HOME -> LIQUID_HOME
            ViewerScreen.REPOSITORIES -> LIQUID_PROJECTS
            ViewerScreen.DOWNLOADS -> LIQUID_DOWNLOADS
            else -> ""
        },
        downloadActive = downloadActive,
        onHome = onHome,
        onProjects = onProjects,
        onDownloads = onDownloads,
        modifier = modifier,
        hazeState = hazeState,
        backdropBlurEnabled = backdropBlurEnabled
    )
}

@Composable
private fun RowScope.LiquidGlassBottomItem(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    onClick: () -> Unit,
    statusActive: Boolean = false
) {
    val foreground = if (selected) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }

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
        if (selected) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .width(20.dp)
                    .height(2.dp)
                    .background(
                        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.92f),
                        shape = RoundedCornerShape(bottomStart = 2.dp, bottomEnd = 2.dp)
                    )
            )
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                modifier = Modifier.size(28.dp),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    modifier = Modifier.size(22.dp),
                    tint = foreground
                )
                if (statusActive) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .size(7.dp)
                            .semantics { contentDescription = "正在下载" }
                            .background(
                                color = MaterialTheme.colorScheme.secondary,
                                shape = RoundedCornerShape(999.dp)
                            )
                    )
                }
            }
            Text(
                text = label,
                color = foreground,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                maxLines = 1
            )
        }
    }
}

private const val LIQUID_HOME = "home"
private const val LIQUID_PROJECTS = "projects"
private const val LIQUID_DOWNLOADS = "downloads"
