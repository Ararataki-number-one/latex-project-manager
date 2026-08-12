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
    val section = 32.dp

    /** TeXFlow v8 uses a generous page gutter without wasting narrow screens. */
    val screenHorizontal = 24.dp
    val screenVertical = 8.dp

    // Compatibility aliases for screens that adopted the first token set.
    val minimumTouchTarget = AppSize.minimumTouchTarget
    val listRowMinimum = AppSize.listRowCompact
}

object AppSize {
    val minimumTouchTarget = 48.dp
    val topBarHeight = 56.dp
    val bottomBarHeight = 64.dp
    val bottomIndicatorWidth = 56.dp
    val bottomIndicatorHeight = 32.dp
    val searchHeight = 48.dp
    val listRowCompact = 48.dp
    val listRow = 56.dp
    val projectRow = 64.dp
    val listIconContainer = 38.dp
    val listIcon = 22.dp
    val dividerInset = 56.dp
}

object AppRadius {
    val icon = 10.dp
    val control = 12.dp
    val search = 14.dp
    val row = 14.dp
    val group = 18.dp
    val card = 18.dp
    val floating = 20.dp
    val sheet = 24.dp
    val pill = 999.dp
}

object AppElevation {
    val none = 0.dp
    val row = 1.dp
    val floating = 6.dp
    val dialog = 12.dp
}

/** Optical layers for the Android Liquid Glass approximation. */
object AppGlass {
    const val lightTopAlpha = 0.92f
    const val lightBottomAlpha = 0.84f
    const val darkTopAlpha = 0.90f
    const val darkBottomAlpha = 0.82f
    const val highlightAlpha = 0.58f
    const val lowlightAlpha = 0.08f

    val borderWidth = 1.dp
    val navigationInset = 12.dp
    val controlInset = 8.dp
    val toolbarRadius = 20.dp
    val capsuleRadius = 999.dp
    val navigationElevation = 6.dp
    val controlElevation = 4.dp
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
