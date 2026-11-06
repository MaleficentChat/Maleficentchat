package com.maleficentchat.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.core.app.RemoteInput
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors

class NotificationReplyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val reply = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(REPLY_KEY)?.toString()?.trim().orEmpty()
        if (reply.isBlank()) return
        val peerId = intent.getStringExtra("peerId") ?: return
        val credential = context.getSharedPreferences("mc", Context.MODE_PRIVATE).getString("device_credential", null)
        if (credential.isNullOrBlank()) {
            Toast.makeText(context, "Open Maleficent Chat to reconnect this device.", Toast.LENGTH_LONG).show()
            return
        }
        val pending = goAsync()
        executor.execute {
            var success = false
            try {
                val connection = (URL("https://maleficentchat.onrender.com/api/native/dm/reply").openConnection() as HttpURLConnection)
                connection.requestMethod = "POST"
                connection.connectTimeout = 12000
                connection.readTimeout = 12000
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setRequestProperty("X-Device-Credential", credential)
                val payload = JSONObject().put("peerId", peerId).put("text", reply).toString()
                connection.outputStream.use { it.write(payload.toByteArray(StandardCharsets.UTF_8)) }
                success = connection.responseCode in 200..299
                if (success) connection.inputStream.close() else connection.errorStream?.close()
                connection.disconnect()
            } catch (_: Exception) { }
            android.os.Handler(context.mainLooper).post {
                Toast.makeText(context, if (success) "Reply sent 💜" else "Reply could not be sent. Open Maleficent Chat to reconnect.", Toast.LENGTH_LONG).show()
            }
            pending.finish()
        }
    }

    companion object {
        const val REPLY_KEY = "maleficent_inline_reply"
        private val executor = Executors.newSingleThreadExecutor()
    }
}
