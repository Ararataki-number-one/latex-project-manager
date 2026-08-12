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
    // Green is the only interactive accent. Neutral colors carry hierarchy.
    primary = Color(0xFF087A5B),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFDDF3EA),
    onPrimaryContainer = Color(0xFF074C3B),
    secondary = Color(0xFF087A5B),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFE7F2EE),
    onSecondaryContainer = Color(0xFF23443B),
    tertiary = Color(0xFF56615C),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFE1E6E3),
    onTertiaryContainer = Color(0xFF3D4742),
    background = Color(0xFFF7F7F5),
    onBackground = Color(0xFF1B1D1B),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF1B1D1B),
    surfaceVariant = Color(0xFFF0F1EF),
    onSurfaceVariant = Color(0xFF626762),
    surfaceTint = Color(0xFF087A5B),
    inverseSurface = Color(0xFF2F312F),
    inverseOnSurface = Color(0xFFF3F4F1),
    inversePrimary = Color(0xFF72D6B4),
    outline = Color(0xFF767B76),
    outlineVariant = Color(0xFFDADDD8),
    scrim = Color.Black,
    error = Color(0xFFBA1A1A),
    onError = Color.White,
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF93000A)
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF75DDB9),
    onPrimary = Color(0xFF00382A),
    primaryContainer = Color(0xFF0B513F),
    onPrimaryContainer = Color(0xFFB3F0D9),
    secondary = Color(0xFF75DDB9),
    onSecondary = Color(0xFF00382A),
    secondaryContainer = Color(0xFF173E34),
    onSecondaryContainer = Color(0xFFC9EAE0),
    tertiary = Color(0xFFC1C8C3),
    onTertiary = Color(0xFF2B332F),
    tertiaryContainer = Color(0xFF3E4742),
    onTertiaryContainer = Color(0xFFDDE5DF),
    background = Color(0xFF111311),
    onBackground = Color(0xFFE5E7E3),
    surface = Color(0xFF191B19),
    onSurface = Color(0xFFE5E7E3),
    surfaceVariant = Color(0xFF252825),
    onSurfaceVariant = Color(0xFFBCC2BC),
    surfaceTint = Color(0xFF75DDB9),
    inverseSurface = Color(0xFFE5E7E3),
    inverseOnSurface = Color(0xFF2E312E),
    inversePrimary = Color(0xFF087A5B),
    outline = Color(0xFF899089),
    outlineVariant = Color(0xFF3E433F),
    scrim = Color.Black,
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6)
)

private val AppTypography = Typography(
    displayLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 48.sp,
        lineHeight = 56.sp,
        letterSpacing = (-0.5).sp
    ),
    displayMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 40.sp,
        lineHeight = 48.sp,
        letterSpacing = (-0.4).sp
    ),
    displaySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 34.sp,
        lineHeight = 42.sp,
        letterSpacing = (-0.3).sp
    ),
    headlineLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 30.sp,
        lineHeight = 38.sp,
        letterSpacing = (-0.2).sp
    ),
    headlineMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 24.sp,
        lineHeight = 32.sp,
        letterSpacing = (-0.1).sp
    ),
    headlineSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
        lineHeight = 28.sp
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 18.sp,
        lineHeight = 26.sp
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 24.sp
    ),
    titleSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 24.sp
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 21.sp
    ),
    bodySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        lineHeight = 18.sp
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp
    ),
    labelMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 16.sp
    )
)

private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(22.dp)
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
