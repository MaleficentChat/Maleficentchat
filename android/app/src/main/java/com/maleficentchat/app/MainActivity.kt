package com.maleficentchat.app

import android.Manifest
import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.ActivityCompat
import com.google.firebase.messaging.FirebaseMessaging

class MainActivity : Activity() {
    private lateinit var web: WebView

    inner class NativeBridge {
        @JavascriptInterface fun saveDeviceCredential(value: String) {
            getSharedPreferences("mc", MODE_PRIVATE).edit().putString("device_credential", value).apply()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 40)
        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.addJavascriptInterface(NativeBridge(), "MaleficentNative")
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                if (!url.startsWith("https://maleficentchat.onrender.com")) return
                FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                    val safeToken = org.json.JSONObject.quote(token)
                    val script = """
                        (function(){
                          if(window.__mcNativeRegistrationStarted) return;
                          window.__mcNativeRegistrationStarted=true;
                          var fcmToken=$safeToken, attempts=0;
                          var timer=setInterval(async function(){
                            attempts++;
                            try {
                              var authToken=localStorage.getItem('mc_token')||'';\n                              if(!authToken) return;\n                              var response=await fetch('/api/native/device/register',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-auth-token':authToken},body:JSON.stringify({fcmToken:fcmToken})});
                              if(response.ok){
                                var data=await response.json();
                                if(data.deviceCredential && window.MaleficentNative){
                                  window.MaleficentNative.saveDeviceCredential(data.deviceCredential);
                                  clearInterval(timer);
                                }
                              }
                            } catch(e) {}
                            if(attempts>=240) clearInterval(timer);
                          },5000);
                        })();
                    """.trimIndent()
                    web.evaluateJavascript(script, null)
                }
            }
        }
        web.loadUrl("https://maleficentchat.onrender.com/")
        setContentView(web)
    }

    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
