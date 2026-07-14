package com.autophoto.gallery

import android.app.Activity
import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.IOException

@InvokeArg
class SaveImageArgs {
  lateinit var sourcePath: String
  lateinit var fileName: String
}

@TauriPlugin
class GalleryPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun saveImage(invoke: Invoke) {
    val args = invoke.parseArgs(SaveImageArgs::class.java)

    Thread {
      var insertedUri: android.net.Uri? = null
      try {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
          throw IOException("系统版本过低，暂不支持直接保存到相册")
        }

        val source = File(args.sourcePath)
        if (!source.isFile) throw IOException("待导出的图片文件不存在")

        val resolver = activity.contentResolver
        val values = ContentValues().apply {
          put(MediaStore.Images.Media.DISPLAY_NAME, args.fileName)
          put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
          put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/AutoPhoto")
          put(MediaStore.Images.Media.IS_PENDING, 1)
        }

        val destinationUri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
          ?: throw IOException("无法在系统相册中创建图片")
        insertedUri = destinationUri

        resolver.openOutputStream(destinationUri)?.use { output ->
          source.inputStream().use { input -> input.copyTo(output) }
        } ?: throw IOException("无法写入系统相册")

        val completedValues = ContentValues().apply {
          put(MediaStore.Images.Media.IS_PENDING, 0)
        }
        resolver.update(destinationUri, completedValues, null, null)

        val result = JSObject().apply {
          put("uri", destinationUri.toString())
          put("fileName", args.fileName)
          put("album", "AutoPhoto")
        }
        invoke.resolve(result)
      } catch (error: Exception) {
        insertedUri?.let { activity.contentResolver.delete(it, null, null) }
        invoke.reject(error.message ?: "保存到系统相册失败")
      }
    }.start()
  }
}
