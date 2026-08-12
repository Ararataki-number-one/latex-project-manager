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
    // Ink drives primary actions; green is reserved for status and progress.
    primary = Color(0xFF1E201D),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFEAEBE7),
    onPrimaryContainer = Color(0xFF1E201D),
    inversePrimary = Color(0xFFD5D7D1),
    secondary = Color(0xFF0C7658),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFDDF3EA),
    onSecondaryContainer = Color(0xFF084B3A),
    tertiary = Color(0xFF59615C),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFE5E9E5),
    onTertiaryContainer = Color(0xFF343B37),
    background = Color(0xFFFAFAF8),
    onBackground = Color(0xFF1B1C19),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF1B1C19),
    surfaceVariant = Color(0xFFF0F1ED),
    onSurfaceVariant = Color(0xFF62665F),
    surfaceTint = Color.Transparent,
    surfaceDim = Color(0xFFDADBD6),
    surfaceBright = Color(0xFFFFFFFF),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF7F7F4),
    surfaceContainer = Color(0xFFF1F2EE),
    surfaceContainerHigh = Color(0xFFEBECE7),
    surfaceContainerHighest = Color(0xFFE5E6E1),
    outline = Color(0xFFBABEB6),
    outlineVariant = Color(0xFFE2E4DE),
    inverseSurface = Color(0xFF2C2E2A),
    inverseOnSurface = Color(0xFFF3F4F0),
    scrim = Color(0xFF000000),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFEE4E2),
    onErrorContainer = Color(0xFF7A271A)
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFF1F2EE),
    onPrimary = Color(0xFF1B1C19),
    primaryContainer = Color(0xFF363834),
    onPrimaryContainer = Color(0xFFF1F2EE),
    inversePrimary = Color(0xFF5E615C),
    secondary = Color(0xFF72D6B1),
    onSecondary = Color(0xFF00382A),
    secondaryContainer = Color(0xFF124F3D),
    onSecondaryContainer = Color(0xFFB3EED7),
    tertiary = Color(0xFFC2C8C3),
    onTertiary = Color(0xFF2C322E),
    tertiaryContainer = Color(0xFF3D4540),
    onTertiaryContainer = Color(0xFFDEE5DF),
    background = Color(0xFF10110F),
    onBackground = Color(0xFFE8EAE5),
    surface = Color(0xFF151714),
    onSurface = Color(0xFFE8EAE5),
    surfaceVariant = Color(0xFF282B27),
    onSurfaceVariant = Color(0xFFBFC3BC),
    surfaceTint = Color.Transparent,
    surfaceDim = Color(0xFF10110F),
    surfaceBright = Color(0xFF363834),
    surfaceContainerLowest = Color(0xFF0C0D0B),
    surfaceContainerLow = Color(0xFF181A17),
    surfaceContainer = Color(0xFF1D1F1C),
    surfaceContainerHigh = Color(0xFF272925),
    surfaceContainerHighest = Color(0xFF32342F),
    outline = Color(0xFF737972),
    outlineVariant = Color(0xFF383B36),
    inverseSurface = Color(0xFFE7E9E4),
    inverseOnSurface = Color(0xFF2A2C28),
    scrim = Color(0xFF000000),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6)
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
    headlineLarge = appText(28, 36, FontWeight.SemiBold),
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
    extraLarge = RoundedCornerShape(24.dp)
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
