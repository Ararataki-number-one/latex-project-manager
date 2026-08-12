package com.zqy.latexviewer.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "repositories")
data class RepositoryEntity(
    @androidx.room.PrimaryKey val fullName: String,
    val name: String,
    val owner: String,
    val description: String?,
    val isPrivate: Boolean,
    val defaultBranch: String,
    val updatedAt: String,
    val htmlUrl: String,
    val sizeKb: Long,
    val commitSha: String?,
    val lastSuccessfulRefreshAt: Long,
    val saved: Boolean = true
)

@Entity(tableName = "mobile_indexes")
data class MobileIndexEntity(
    @androidx.room.PrimaryKey val repositoryFullName: String,
    val payload: String,
    val commitSha: String?,
    val lastSuccessfulRefreshAt: Long
)

@Entity(tableName = "reading_progress")
data class ReadingProgressEntity(
    @androidx.room.PrimaryKey val documentId: String,
    val schemaVersion: Int,
    val repositoryFullName: String,
    val projectName: String,
    val pdfPath: String,
    val pdfName: String,
    val sha: String,
    val pageIndex: Int,
    val pageCount: Int,
    val lastReadAt: Long
)

@Entity(
    tableName = "pdf_bookmarks",
    indices = [Index(value = ["repositoryFullName", "pdfPath", "pageIndex"], unique = true)]
)
data class PdfBookmarkEntity(
    @androidx.room.PrimaryKey val id: String,
    val repositoryFullName: String,
    val pdfPath: String,
    val pageIndex: Int,
    val label: String?,
    val createdAt: Long
)

@Entity(
    tableName = "download_tasks",
    indices = [Index(value = ["uniqueKey"])]
)
data class DownloadTaskEntity(
    @androidx.room.PrimaryKey val id: String,
    val uniqueKey: String,
    val name: String,
    val kind: String,
    val state: String,
    val downloaded: Long,
    val total: Long,
    val bytesPerSecond: Long,
    val repositoryFullName: String?,
    val path: String?,
    val commitSha: String?,
    val blobSha: String?,
    val error: String?,
    val taskPayload: String?,
    val createdAt: Long,
    val updatedAt: Long
)

@Entity(tableName = "download_history")
data class DownloadHistoryEntity(
    @androidx.room.PrimaryKey val id: String,
    val name: String,
    val contentUri: String,
    val displayPath: String,
    val mimeType: String,
    val size: Long,
    val downloadedAt: Long,
    val kind: String,
    val sourceRepository: String?,
    val sourcePath: String?
)

@Entity(
    tableName = "pdf_cache",
    indices = [Index(value = ["repositoryFullName", "pdfPath", "sha"])]
)
data class PdfCacheEntity(
    @androidx.room.PrimaryKey val cacheKey: String,
    val localPath: String,
    val size: Long,
    val lastAccessAt: Long,
    val repositoryFullName: String?,
    val pdfPath: String?,
    val sha: String?,
    val knownGood: Boolean
)

@Entity(tableName = "metadata")
data class MetadataEntity(
    @androidx.room.PrimaryKey val key: String,
    val value: String
)

@Dao
interface ViewerDao {
    @Query("SELECT * FROM repositories WHERE saved = 1 ORDER BY updatedAt DESC, fullName COLLATE NOCASE")
    suspend fun repositories(): List<RepositoryEntity>

    @Query("SELECT * FROM repositories WHERE saved = 1 ORDER BY updatedAt DESC, fullName COLLATE NOCASE")
    fun observeRepositories(): Flow<List<RepositoryEntity>>

    @Query("SELECT * FROM repositories WHERE fullName = :fullName COLLATE NOCASE LIMIT 1")
    suspend fun repository(fullName: String): RepositoryEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertRepository(entity: RepositoryEntity)

    @Query("UPDATE repositories SET saved = 0 WHERE fullName = :fullName COLLATE NOCASE")
    suspend fun removeRepository(fullName: String)

    @Query("SELECT * FROM mobile_indexes")
    suspend fun mobileIndexes(): List<MobileIndexEntity>

    @Query("SELECT * FROM mobile_indexes WHERE repositoryFullName = :repositoryFullName COLLATE NOCASE LIMIT 1")
    suspend fun mobileIndex(repositoryFullName: String): MobileIndexEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertMobileIndex(entity: MobileIndexEntity)

    @Query("DELETE FROM mobile_indexes WHERE repositoryFullName = :repositoryFullName COLLATE NOCASE")
    suspend fun deleteMobileIndex(repositoryFullName: String)

    @Query("SELECT * FROM reading_progress ORDER BY lastReadAt DESC")
    suspend fun readingProgress(): List<ReadingProgressEntity>

    @Query("SELECT * FROM reading_progress ORDER BY lastReadAt DESC")
    fun observeReadingProgress(): Flow<List<ReadingProgressEntity>>

    @Query("SELECT * FROM reading_progress WHERE documentId = :documentId LIMIT 1")
    suspend fun readingProgress(documentId: String): ReadingProgressEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertReadingProgress(entity: ReadingProgressEntity)

    @Query("SELECT * FROM pdf_bookmarks WHERE repositoryFullName = :repositoryFullName COLLATE NOCASE AND pdfPath = :pdfPath ORDER BY pageIndex")
    suspend fun bookmarks(repositoryFullName: String, pdfPath: String): List<PdfBookmarkEntity>

    @Query("SELECT * FROM pdf_bookmarks ORDER BY createdAt DESC")
    suspend fun allBookmarks(): List<PdfBookmarkEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertBookmark(entity: PdfBookmarkEntity)

    @Query("DELETE FROM pdf_bookmarks WHERE id = :id")
    suspend fun deleteBookmark(id: String)

    @Query("SELECT * FROM download_tasks ORDER BY createdAt DESC")
    fun observeDownloadTasks(): Flow<List<DownloadTaskEntity>>

    @Query("SELECT * FROM download_tasks ORDER BY createdAt DESC")
    suspend fun downloadTasks(): List<DownloadTaskEntity>

    @Query("SELECT * FROM download_tasks WHERE id = :id LIMIT 1")
    suspend fun downloadTask(id: String): DownloadTaskEntity?

    @Query("SELECT * FROM download_tasks WHERE uniqueKey = :uniqueKey AND state IN ('QUEUED','RUNNING','WAITING_FOR_NETWORK') ORDER BY createdAt DESC LIMIT 1")
    suspend fun activeDownloadByUniqueKey(uniqueKey: String): DownloadTaskEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertDownloadTask(entity: DownloadTaskEntity)

    @Query("UPDATE download_tasks SET state = :state, downloaded = :downloaded, total = :total, bytesPerSecond = :bytesPerSecond, error = :error, updatedAt = :updatedAt WHERE id = :id")
    suspend fun updateDownloadTaskState(
        id: String,
        state: String,
        downloaded: Long,
        total: Long,
        bytesPerSecond: Long,
        error: String?,
        updatedAt: Long
    )

    @Query("DELETE FROM download_tasks WHERE state IN ('SUCCEEDED','CANCELLED') AND updatedAt < :before")
    suspend fun pruneFinishedTasks(before: Long)

    @Query("SELECT * FROM download_history ORDER BY downloadedAt DESC LIMIT :limit")
    suspend fun downloadHistory(limit: Int): List<DownloadHistoryEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertDownloadHistory(entity: DownloadHistoryEntity)

    @Query("DELETE FROM download_history WHERE id = :id")
    suspend fun deleteDownloadHistory(id: String)

    @Query("DELETE FROM download_history")
    suspend fun clearDownloadHistory()

    @Query("DELETE FROM download_history WHERE id NOT IN (SELECT id FROM download_history ORDER BY downloadedAt DESC LIMIT :limit)")
    suspend fun trimDownloadHistory(limit: Int)

    @Query("SELECT * FROM pdf_cache ORDER BY lastAccessAt DESC")
    suspend fun pdfCacheEntries(): List<PdfCacheEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertPdfCache(entity: PdfCacheEntity)

    @Query("DELETE FROM pdf_cache WHERE cacheKey = :cacheKey")
    suspend fun deletePdfCache(cacheKey: String)

    @Query("DELETE FROM pdf_cache")
    suspend fun clearPdfCacheIndex()

    @Query("SELECT value FROM metadata WHERE `key` = :key LIMIT 1")
    suspend fun metadata(key: String): String?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putMetadata(entity: MetadataEntity)
}

@Database(
    entities = [
        RepositoryEntity::class,
        MobileIndexEntity::class,
        ReadingProgressEntity::class,
        PdfBookmarkEntity::class,
        DownloadTaskEntity::class,
        DownloadHistoryEntity::class,
        PdfCacheEntity::class,
        MetadataEntity::class
    ],
    version = 1,
    exportSchema = true
)
abstract class ViewerDatabase : RoomDatabase() {
    abstract fun viewerDao(): ViewerDao

    companion object {
        @Volatile private var instance: ViewerDatabase? = null

        fun get(context: Context): ViewerDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                ViewerDatabase::class.java,
                "latex_viewer.db"
            ).build().also { instance = it }
        }
    }
}
