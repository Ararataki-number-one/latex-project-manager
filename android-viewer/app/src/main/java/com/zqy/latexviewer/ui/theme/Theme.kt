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
    // Apple-like system blue drives actions; green remains semantic status/progress.
    primary = Color(0xFF007AFF),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFDCEBFF),
    onPrimaryContainer = Color(0xFF003A75),
    inversePrimary = Color(0xFF0A84FF),
    secondary = Color(0xFF248A3D),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFDCF7E4),
    onSecondaryContainer = Color(0xFF0B4F20),
    tertiary = Color(0xFF5856D6),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFE7E5FF),
    onTertiaryContainer = Color(0xFF2E2B82),
    background = Color(0xFFF2F2F7),
    onBackground = Color(0xFF1C1C1E),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF1C1C1E),
    surfaceVariant = Color(0xFFE9E9EE),
    onSurfaceVariant = Color(0xFF5C5C60),
    surfaceTint = Color.Transparent,
    surfaceDim = Color(0xFFD1D1D6),
    surfaceBright = Color(0xFFFFFFFF),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF9F9FB),
    surfaceContainer = Color(0xFFF2F2F7),
    surfaceContainerHigh = Color(0xFFECECF1),
    surfaceContainerHighest = Color(0xFFE5E5EA),
    outline = Color(0xFF8E8E93),
    outlineVariant = Color(0xFFD1D1D6),
    inverseSurface = Color(0xFF1C1C1E),
    inverseOnSurface = Color(0xFFF2F2F7),
    scrim = Color(0xFF000000),
    error = Color(0xFFD70015),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFE5E5),
    onErrorContainer = Color(0xFF8A0010)
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF0A84FF),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFF0A3B68),
    onPrimaryContainer = Color(0xFFD7EAFF),
    inversePrimary = Color(0xFF007AFF),
    secondary = Color(0xFF30D158),
    onSecondary = Color(0xFF002108),
    secondaryContainer = Color(0xFF103D1E),
    onSecondaryContainer = Color(0xFFB8F7C8),
    tertiary = Color(0xFFBF5AF2),
    onTertiary = Color(0xFF2C003D),
    tertiaryContainer = Color(0xFF4B1D61),
    onTertiaryContainer = Color(0xFFF2D7FF),
    background = Color(0xFF000000),
    onBackground = Color(0xFFF2F2F7),
    surface = Color(0xFF1C1C1E),
    onSurface = Color(0xFFF2F2F7),
    surfaceVariant = Color(0xFF2C2C2E),
    onSurfaceVariant = Color(0xFFAEAEB2),
    surfaceTint = Color.Transparent,
    surfaceDim = Color(0xFF000000),
    surfaceBright = Color(0xFF3A3A3C),
    surfaceContainerLowest = Color(0xFF000000),
    surfaceContainerLow = Color(0xFF151517),
    surfaceContainer = Color(0xFF1C1C1E),
    surfaceContainerHigh = Color(0xFF242426),
    surfaceContainerHighest = Color(0xFF2C2C2E),
    outline = Color(0xFF636366),
    outlineVariant = Color(0xFF38383A),
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
