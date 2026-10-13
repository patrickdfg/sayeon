// 폰에 깔린 모든 음성 엔진(구글·삼성 등)의 한국어 목소리를 사이트(app-tts.js)에 건네고 읽어 준다.
package io.github.patrickdfg.sayeon;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public class TtsBridge {
    private static final int CHUNK = 3000;   // 엔진마다 한 번에 읽는 길이에 한도가 있다

    private final Context ctx;
    private final WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());

    // 엔진 패키지 이름 → 엔진, 그리고 사람이 읽는 이름
    private final Map<String, TextToSpeech> engines = new LinkedHashMap<>();
    private final Map<String, String> labels = new LinkedHashMap<>();
    private TextToSpeech first;
    private String defaultEngine = "";
    private int pending;
    private volatile String voicesJson = "[]";

    // 지금 읽는 발화 — 사이트가 붙인 번호와 남은 토막 수
    private String currentId;
    private int remaining;
    private boolean closed;

    TtsBridge(Context ctx, WebView web) {
        this.ctx = ctx.getApplicationContext();
        this.web = web;
        ui.post(this::start);
    }

    /* ---------- 시작: 기본 엔진을 열고, 거기서 알려 주는 다른 엔진도 모두 연다 ---------- */

    private void start() {
        first = new TextToSpeech(ctx, status -> ui.post(() -> onFirstReady(status)));
    }

    private void onFirstReady(int status) {
        if (closed) return;
        if (status != TextToSpeech.SUCCESS) {
            finish();
            return;
        }
        defaultEngine = first.getDefaultEngine();
        List<TextToSpeech.EngineInfo> infos = first.getEngines();
        for (TextToSpeech.EngineInfo info : infos) {
            labels.put(info.name, shortLabel(info.name, info.label));
        }
        engines.put(defaultEngine, first);
        listen(first);
        for (TextToSpeech.EngineInfo info : infos) {
            if (info.name.equals(defaultEngine)) continue;
            final String pkg = info.name;
            pending++;
            opening.put(pkg, new TextToSpeech(ctx, st -> ui.post(() -> onOtherReady(pkg, st)), pkg));
        }
        if (pending == 0) finish();
    }

    // 생성자가 끝나기 전에 콜백이 올 수 있어 엔진을 콜백에서 다시 찾지 못한다 — 만들 때 잡아 둔다
    private final Map<String, TextToSpeech> opening = new LinkedHashMap<>();

    private void onOtherReady(String pkg, int status) {
        pending--;
        TextToSpeech t = opening.remove(pkg);
        if (t != null) {
            if (status == TextToSpeech.SUCCESS) {
                engines.put(pkg, t);
                listen(t);
            } else {
                t.shutdown();
            }
        }
        if (pending == 0) finish();
    }

    private void finish() {
        voicesJson = buildVoices();
        tellPage("window.__sayeonTts&&window.__sayeonTts.ready()");
    }

    private static String shortLabel(String pkg, String label) {
        if (pkg.startsWith("com.google")) return "Google";
        if (pkg.startsWith("com.samsung")) return "삼성";
        return label == null || label.isEmpty() ? pkg : label;
    }

    /* ---------- 목소리 목록 ---------- */

    private String buildVoices() {
        List<JSONObject> rows = new ArrayList<>();
        for (Map.Entry<String, TextToSpeech> e : engines.entrySet()) {
            Set<Voice> set;
            try {
                set = e.getValue().getVoices();
            } catch (RuntimeException ex) {
                continue;
            }
            if (set == null) continue;
            for (Voice v : set) {
                if (!"ko".equals(v.getLocale().getLanguage())) continue;
                if (v.getFeatures() != null
                        && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                try {
                    JSONObject o = new JSONObject();
                    o.put("id", e.getKey() + "|" + v.getName());
                    o.put("name", labels.get(e.getKey()) + " " + variant(v.getName()));
                    o.put("lang", v.getLocale().toLanguageTag());
                    o.put("local", !v.isNetworkConnectionRequired());
                    o.put("engine", e.getKey());
                    rows.add(o);
                } catch (JSONException ignored) { }
            }
        }
        // 구글을 앞에, 기기 안에 든 것을 네트워크보다 앞에 둔다(안 끊기는 쪽이 먼저)
        Collections.sort(rows, (a, b) -> {
            int ga = a.optString("engine").startsWith("com.google") ? 0 : 1;
            int gb = b.optString("engine").startsWith("com.google") ? 0 : 1;
            if (ga != gb) return ga - gb;
            int la = a.optBoolean("local") ? 0 : 1;
            int lb = b.optBoolean("local") ? 0 : 1;
            if (la != lb) return la - lb;
            return a.optString("name").compareTo(b.optString("name"));
        });
        return new JSONArray(rows).toString();
    }

    // 'ko-kr-x-ism-local' → 'ISM'. 성별은 목소리 이름만으로 알 수 없어 적지 않는다.
    private static String variant(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        int at = n.indexOf("-x-");
        if (at >= 0) {
            String rest = n.substring(at + 3);
            int dash = rest.indexOf('-');
            return (dash > 0 ? rest.substring(0, dash) : rest).toUpperCase(Locale.ROOT);
        }
        return name;
    }

    @JavascriptInterface
    public String voices() {
        return voicesJson;
    }

    /* ---------- 읽기 ---------- */

    @JavascriptInterface
    public void speak(final String id, final String text, final String voiceId, final float rate) {
        ui.post(() -> doSpeak(id, text, voiceId, rate));
    }

    @JavascriptInterface
    public void stop() {
        ui.post(this::doStop);
    }

    private void doSpeak(String id, String text, String voiceId, float rate) {
        if (closed) return;
        doStop();
        String pkg = defaultEngine;
        String voiceName = null;
        if (voiceId != null && voiceId.contains("|")) {
            int bar = voiceId.indexOf('|');
            pkg = voiceId.substring(0, bar);
            voiceName = voiceId.substring(bar + 1);
        }
        TextToSpeech t = engines.get(pkg);
        if (t == null) {
            t = first;
            voiceName = null;
        }
        if (t == null) {
            tellPage("window.__sayeonTts&&window.__sayeonTts.event(" + JSONObject.quote(id) + ",'error')");
            return;
        }
        boolean set = false;
        if (voiceName != null) {
            try {
                for (Voice v : t.getVoices()) {
                    if (v.getName().equals(voiceName)) {
                        set = t.setVoice(v) == TextToSpeech.SUCCESS;
                        break;
                    }
                }
            } catch (RuntimeException ignored) { }
        }
        if (!set) t.setLanguage(Locale.KOREA);
        t.setSpeechRate(Math.max(0.1f, Math.min(4f, rate)));

        List<String> pieces = split(text);
        currentId = id;
        remaining = pieces.size();
        for (int i = 0; i < pieces.size(); i++) {
            int mode = i == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD;
            if (t.speak(pieces.get(i), mode, null, id + "#" + i) != TextToSpeech.SUCCESS) {
                fail(id);
                return;
            }
        }
    }

    private void doStop() {
        // 먼저 비워서, 멈추느라 뒤늦게 오는 콜백이 사이트에 '끝났다'로 전해지지 않게 한다
        currentId = null;
        remaining = 0;
        for (TextToSpeech t : engines.values()) {
            try {
                t.stop();
            } catch (RuntimeException ignored) { }
        }
    }

    private static List<String> split(String text) {
        List<String> out = new ArrayList<>();
        String rest = text == null ? "" : text;
        while (rest.length() > CHUNK) {
            int cut = rest.lastIndexOf(' ', CHUNK);
            if (cut < CHUNK / 2) cut = CHUNK;
            out.add(rest.substring(0, cut));
            rest = rest.substring(cut).trim();
        }
        out.add(rest);
        return out;
    }

    private void listen(TextToSpeech t) {
        t.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String uid) {
                ui.post(() -> {
                    if (uid.equals(base(uid) + "#0")) tell(base(uid), "start");
                });
            }
            @Override public void onDone(String uid) {
                ui.post(() -> {
                    String id = base(uid);
                    if (!id.equals(currentId)) return;
                    if (--remaining <= 0) {
                        currentId = null;
                        tell(id, "end");
                    }
                });
            }
            @Override public void onError(String uid) {
                ui.post(() -> fail(base(uid)));
            }
            @Override public void onStop(String uid, boolean interrupted) {
                // 멈춘 것은 알리지 않는다 — 사이트가 멈추라고 한 것이라 다음 일을 이미 정했다
            }
        });
    }

    private static String base(String uid) {
        int h = uid.lastIndexOf('#');
        return h < 0 ? uid : uid.substring(0, h);
    }

    private void fail(String id) {
        if (!id.equals(currentId)) return;
        currentId = null;
        remaining = 0;
        tell(id, "error");
    }

    private void tell(String id, String type) {
        if (type.equals("start") && !id.equals(currentId)) return;
        tellPage("window.__sayeonTts&&window.__sayeonTts.event(" + JSONObject.quote(id) + ",'" + type + "')");
    }

    private void tellPage(String js) {
        ui.post(() -> {
            if (!closed) web.evaluateJavascript(js, null);
        });
    }

    void shutdown() {
        closed = true;
        for (TextToSpeech t : engines.values()) {
            try {
                t.stop();
                t.shutdown();
            } catch (RuntimeException ignored) { }
        }
        engines.clear();
    }
}
