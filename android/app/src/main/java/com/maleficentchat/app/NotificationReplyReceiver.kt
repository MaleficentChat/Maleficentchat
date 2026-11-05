package com.maleficentchat.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput

class NotificationReplyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val reply = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(REPLY_KEY)?.toString()?.trim().orEmpty()
        if (reply.isBlank()) return
        val peerId = intent.getStringExtra("peerId") ?: return
        // Secure delivery is intentionally pending until the backend can issue and revoke
        // per-device credentials. Never store the user's password in the APK.
        context.getSharedPreferences("mc", Context.MODE_PRIVATE).edit().putString("pending_reply_peer", peerId).putString("pending_reply_text", reply).apply()
    }
    companion object { const val REPLY_KEY = "maleficent_inline_reply" }
}
