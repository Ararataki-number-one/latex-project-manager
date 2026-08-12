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
    val section = 36.dp

    val screenHorizontal = 20.dp
    val screenVertical = 16.dp
    val minimumTouchTarget = 48.dp
    val listRowMinimum = 56.dp
}

/**
 * Purposeful motion stays brief: touch feedback is immediate, entrances ease out,
 * spatial changes use a smooth curve, and progress remains linear.
 */
object AppMotion {
    const val pressMillis = 120
    const val exitMillis = 160
    const val enterMillis = 180
    const val stateChangeMillis = 220
    const val containerMillis = 280

    val enterEasing = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)
    val standardEasing = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    val progressEasing = LinearEasing
}
