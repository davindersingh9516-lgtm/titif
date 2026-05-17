package com.tiffin.app;

import android.os.Bundle;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Enable Chrome DevTools remote debugging for diagnosing JS issues.
        // Safe to leave in release: only accessible via USB + ADB, no production risk.
        WebView.setWebContentsDebuggingEnabled(true);
    }

    /**
     * Re-establishes the WebView ↔ IME Binder IPC whenever this window gains
     * focus (cold launch AND every resume after Motorola's moto_freezer severs
     * the connection on screen-off). Using restartInput() at the native layer
     * is more reliable than the JS warmIme() approach because it fires before
     * any JavaScript runs, giving the Binder handshake a head-start before the
     * user can tap the first input field.
     */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus) return;

        View webView = getBridge().getWebView();
        if (webView == null) return;

        InputMethodManager imm =
            (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (imm == null) return;

        imm.restartInput(webView);
    }
}
