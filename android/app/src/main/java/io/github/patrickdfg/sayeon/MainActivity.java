// 성령말씀 앱 화면 — 사이트를 그대로 띄우는 껍데기라, 글·소리 업데이트는 사이트에 올리면 바로 보인다.
package io.github.patrickdfg.sayeon;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    static final String HOME = "https://patrickdfg.github.io/sayeon/";
    static final String HOST = "patrickdfg.github.io";

    private WebView web;
    private TtsBridge tts;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(0xFF1B2018);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " SayeonApp/1");

        tts = new TtsBridge(this, web);
        web.addJavascriptInterface(tts, "SayeonApp");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri uri = req.getUrl();
                if (HOST.equals(uri.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) { }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (!req.isForMainFrame()) return;
                String html = "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                        + "<body style='background:#1b2018;color:#e9ece4;font:18px sans-serif;"
                        + "text-align:center;padding:30vh 24px'>"
                        + "<p>연결할 수 없습니다.<br>인터넷을 확인해 주세요.</p>"
                        + "<p><button style='font-size:18px;padding:10px 24px' "
                        + "onclick=\"location.href='" + HOME + "'\">다시 시도</button></p>";
                view.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
            }
        });

        if (state == null) {
            web.loadUrl(HOME);
        } else {
            web.restoreState(state);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        tts.shutdown();
        super.onDestroy();
    }
}
