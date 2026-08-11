package com.zqy.latexviewer

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import com.zqy.latexviewer.data.AppPreferences
import com.zqy.latexviewer.data.DownloadStore
import com.zqy.latexviewer.data.GitHubApi
import com.zqy.latexviewer.data.SecureTokenStore
import com.zqy.latexviewer.ui.LaTeXViewerApp
import com.zqy.latexviewer.ui.ViewerViewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val api = GitHubApi()
        val tokenStore = SecureTokenStore(applicationContext)
        val downloadStore = DownloadStore(applicationContext)
        val preferences = AppPreferences(applicationContext)
        setContent {
            val viewerViewModel: ViewerViewModel = viewModel(
                factory = ViewerViewModel.factory(
                    api,
                    tokenStore,
                    downloadStore,
                    preferences,
                    BuildConfig.VERSION_NAME
                )
            )
            LaTeXViewerApp(viewerViewModel)
        }
    }
}
