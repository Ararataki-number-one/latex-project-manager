package com.zqy.latexviewer.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val LightColors = lightColorScheme(
    // TeXFlow v8 is deliberately monochrome. Green is reserved for success.
    primary = Color(0xFF111111),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFF0F0EE),
    onPrimaryContainer = Color(0xFF111111),
    inversePrimary = Color(0xFFF5F5F3),
    secondary = Color(0xFF248A3D),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFDCF7E4),
    onSecondaryContainer = Color(0xFF0B4F20),
    tertiary = Color(0xFF6C6C70),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFF2F2F0),
    onTertiaryContainer = Color(0xFF303033),
    background = Color(0xFFFFFFFF),
    onBackground = Color(0xFF111111),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF111111),
    surfaceVariant = Color(0xFFF7F7F5),
    onSurfaceVariant = Color(0xFF727272),
    surfaceTint = Color.Transparent,
    surfaceDim = Color(0xFFE7E7E4),
    surfaceBright = Color(0xFFFFFFFF),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFFCFCFB),
    surfaceContainer = Color(0xFFF7F7F5),
    surfaceContainerHigh = Color(0xFFF2F2F0),
    surfaceContainerHighest = Color(0xFFECECEA),
    outline = Color(0xFFB7B7B2),
    outlineVariant = Color(0xFFECECEA),
    inverseSurface = Color(0xFF111111),
    inverseOnSurface = Color(0xFFFFFFFF),
    scrim = Color(0xFF000000),
    error = Color(0xFFD70015),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFE5E5),
    onErrorContainer = Color(0xFF8A0010)
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFF5F5F3),
    onPrimary = Color(0xFF111111),
    primaryContainer = Color(0xFF303032),
    onPrimaryContainer = Color(0xFFF5F5F3),
    inversePrimary = Color(0xFF111111),
    secondary = Color(0xFF30D158),
    onSecondary = Color(0xFF002108),
    secondaryContainer = Color(0xFF103D1E),
    onSecondaryContainer = Color(0xFFB8F7C8),
    tertiary = Color(0xFFB8B8BC),
    onTertiary = Color(0xFF1C1C1E),
    tertiaryContainer = Color(0xFF343436),
    onTertiaryContainer = Color(0xFFE8E8EA),
    background = Color(0xFF111113),
    onBackground = Color(0xFFF2F2F7),
    surface = Color(0xFF1C1C1E),
    onSurface = Color(0xFFF2F2F7),
    surfaceVariant = Color(0xFF28282A),
    onSurfaceVariant = Color(0xFFAEAEB2),
    surfaceTint = Color.Transparent,
    surfaceDim = Color(0xFF0B0B0C),
    surfaceBright = Color(0xFF3A3A3C),
    surfaceContainerLowest = Color(0xFF111113),
    surfaceContainerLow = Color(0xFF151517),
    surfaceContainer = Color(0xFF1C1C1E),
    surfaceContainerHigh = Color(0xFF242426),
    surfaceContainerHighest = Color(0xFF2C2C2E),
    outline = Color(0xFF69696D),
    outlineVariant = Color(0xFF353537),
    inverseSurface = Color(0xFFF2F2F7),
    inverseOnSurface = Color(0xFF1C1C1E),
    scrim = Color(0xFF000000),
    error = Color(0xFFFF453A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFF5C1110),
    onErrorContainer = Color(0xFFFFDAD7)
)

private fun appText(
    size: Int,
    lineHeight: Int,
    weight: FontWeight = FontWeight.Normal
) = TextStyle(
    fontFamily = FontFamily.SansSerif,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = lineHeight.sp,
    // Neutral tracking keeps both Chinese and Latin project names readable.
    letterSpacing = 0.sp
)

private val AppTypography = Typography(
    displayLarge = appText(40, 48, FontWeight.SemiBold),
    displayMedium = appText(36, 44, FontWeight.SemiBold),
    displaySmall = appText(32, 40, FontWeight.SemiBold),
    headlineLarge = appText(30, 38, FontWeight.SemiBold),
    headlineMedium = appText(24, 32, FontWeight.SemiBold),
    headlineSmall = appText(20, 28, FontWeight.SemiBold),
    titleLarge = appText(18, 24, FontWeight.SemiBold),
    titleMedium = appText(16, 22, FontWeight.Medium),
    titleSmall = appText(14, 20, FontWeight.Medium),
    bodyLarge = appText(16, 24),
    bodyMedium = appText(14, 20),
    bodySmall = appText(12, 18),
    labelLarge = appText(14, 20, FontWeight.Medium),
    labelMedium = appText(12, 16, FontWeight.Medium),
    labelSmall = appText(11, 16, FontWeight.Medium)
)

private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(28.dp)
)

@Composable
fun LaTeXViewerTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        typography = AppTypography,
        shapes = AppShapes,
        content = content
    )
}
