package com.zqy.latexviewer

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import com.zqy.latexviewer.data.AppPreferences
import com.zqy.latexviewer.data.BackgroundDownloadManager
import com.zqy.latexviewer.data.DownloadStore
import com.zqy.latexviewer.data.GitHubApi
import com.zqy.latexviewer.data.SecureTokenStore
import com.zqy.latexviewer.ui.LaTeXViewerApp
import com.zqy.latexviewer.ui.ViewerViewModel

class MainActivity : ComponentActivity() {
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        val api = GitHubApi()
        val tokenStore = SecureTokenStore(applicationContext)
        val downloadStore = DownloadStore(applicationContext)
        val preferences = AppPreferences(applicationContext)
        val backgroundDownloads = BackgroundDownloadManager(applicationContext)
        setContent {
            val viewerViewModel: ViewerViewModel = viewModel(
                factory = ViewerViewModel.factory(
                    api,
                    tokenStore,
                    downloadStore,
                    backgroundDownloads,
                    preferences,
                    BuildConfig.VERSION_NAME
                )
            )
            LaTeXViewerApp(viewerViewModel)
        }
    }
}
