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
    primary = Color(0xFF171717),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE8F5F1),
    onPrimaryContainer = Color(0xFF075B48),
    secondary = Color(0xFF10A37F),
    onSecondary = Color.White,
    background = Color(0xFFF7F7F8),
    onBackground = Color(0xFF111111),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF111111),
    surfaceVariant = Color(0xFFF0F0F0),
    onSurfaceVariant = Color(0xFF666666),
    outline = Color(0xFFD9D9D9),
    outlineVariant = Color(0xFFE9E9E9),
    error = Color(0xFFB42318),
    errorContainer = Color(0xFFFFE9E7)
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFECECEC),
    onPrimary = Color(0xFF171717),
    primaryContainer = Color(0xFF173F36),
    onPrimaryContainer = Color(0xFFA8E8D7),
    secondary = Color(0xFF19C394),
    onSecondary = Color(0xFF08251E),
    background = Color(0xFF171717),
    onBackground = Color(0xFFECECEC),
    surface = Color(0xFF212121),
    onSurface = Color(0xFFECECEC),
    surfaceVariant = Color(0xFF2F2F2F),
    onSurfaceVariant = Color(0xFFB8B8B8),
    outline = Color(0xFF484848),
    outlineVariant = Color(0xFF353535),
    error = Color(0xFFFFB4AB),
    errorContainer = Color(0xFF5C1B17)
)

private val AppTypography = Typography(
    headlineLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 30.sp,
        lineHeight = 36.sp
    ),
    headlineSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 21.sp,
        lineHeight = 27.sp
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 22.sp
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
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp
    )
)

private val AppShapes = Shapes(
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(22.dp)
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
