package com.zqy.latexviewer.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.ui.unit.dp

/**
 * Shared spacing values for a calm, predictable layout rhythm.
 * Interactive controls should never be smaller than [minimumTouchTarget].
 */
object AppSpacing {
    val xxs = 4.dp
    val xs = 8.dp
    val sm = 12.dp
    val md = 16.dp
    val lg = 20.dp
    val xl = 24.dp
    val xxl = 32.dp
    val section = 40.dp

    val screenHorizontal = 20.dp
    val screenVertical = 12.dp

    // Compatibility aliases for screens that adopted the first token set.
    val minimumTouchTarget = AppSize.minimumTouchTarget
    val listRowMinimum = AppSize.listRowCompact
}

object AppSize {
    val minimumTouchTarget = 48.dp
    val topBarHeight = 56.dp
    val bottomBarHeight = 72.dp
    val bottomIndicatorWidth = 56.dp
    val bottomIndicatorHeight = 32.dp
    val searchHeight = 48.dp
    val listRowCompact = 56.dp
    val listRow = 64.dp
    val projectRow = 72.dp
    val listIconContainer = 40.dp
    val listIcon = 22.dp
    val dividerInset = 56.dp
}

object AppRadius {
    val icon = 10.dp
    val control = 12.dp
    val search = 18.dp
    val card = 18.dp
    val floating = 26.dp
    val sheet = 28.dp
    val pill = 999.dp
}

object AppElevation {
    val none = 0.dp
    val floating = 8.dp
    val dialog = 12.dp
}

/** Optical layers for the Android Liquid Glass approximation. */
object AppGlass {
    const val lightTopAlpha = 0.82f
    const val lightBottomAlpha = 0.62f
    const val darkTopAlpha = 0.74f
    const val darkBottomAlpha = 0.56f
    const val highlightAlpha = 0.72f
    const val lowlightAlpha = 0.16f

    val borderWidth = 1.dp
    val navigationInset = 12.dp
    val controlInset = 8.dp
    val toolbarRadius = 26.dp
    val capsuleRadius = 999.dp
    val navigationElevation = 10.dp
    val controlElevation = 7.dp
}

/**
 * Purposeful motion stays brief: touch feedback is immediate, entrances ease out,
 * spatial changes use a smooth curve, and progress remains linear.
 */
object AppMotion {
    const val pressMillis = 100
    const val exitMillis = 140
    const val selectionMillis = 160
    const val enterMillis = 180
    const val stateChangeMillis = 220
    const val containerMillis = 260

    val enterEasing = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)
    val standardEasing = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    val progressEasing = LinearEasing
}
