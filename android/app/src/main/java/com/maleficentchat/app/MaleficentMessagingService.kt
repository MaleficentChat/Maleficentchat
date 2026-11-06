package com.maleficentchat.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class MaleficentMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        getSharedPreferences("mc", Context.MODE_PRIVATE).edit().putString("fcm_token", token).apply()
    }
    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val peerId = data["peerId"] ?: return
        val channel = "private_messages"
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(channel, "Private messages", NotificationManager.IMPORTANCE_HIGH))
        val replyIntent = Intent(this, NotificationReplyReceiver::class.java).putExtra("peerId", peerId)
        val replyPending = PendingIntent.getBroadcast(this, peerId.hashCode(), replyIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
        val remoteInput = RemoteInput.Builder(NotificationReplyReceiver.REPLY_KEY).setLabel("Reply…").build()
        val reply = NotificationCompat.Action.Builder(android.R.drawable.ic_menu_send, "Reply", replyPending).addRemoteInput(remoteInput).setAllowGeneratedReplies(true).build()
        val openPending = PendingIntent.getActivity(this, 1, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val body = data["body"] ?: "New private message"
        val notification = NotificationCompat.Builder(this, channel).setSmallIcon(android.R.drawable.sym_action_chat).setContentTitle(data["sender"] ?: "Maleficent Chat").setContentText(body).setStyle(NotificationCompat.BigTextStyle().bigText(body)).addAction(reply).setContentIntent(openPending).setAutoCancel(true).build()
        manager.notify(peerId.hashCode(), notification)
    }
}
