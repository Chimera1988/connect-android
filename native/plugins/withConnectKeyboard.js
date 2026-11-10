const {withDangerousMod}=require('expo/config-plugins');
const fs=require('fs'),path=require('path');
function patch(source){
 if(source.includes('// CONNECT_VISIBLE_VIEWPORT_V2'))return source;
 if(source.includes('// CONNECT_VISIBLE_VIEWPORT:')){
  source=source.replace(/\n\s*\/\/ CONNECT_VISIBLE_VIEWPORT:[\s\S]*?(?=\n\s*public RNCWebView\(ThemedReactContext reactContext\))/, '\n    ')
   .replace('\n        getViewTreeObserver().addOnGlobalLayoutListener(connectKeyboardLayout);','')
   .replace('\n        if (getViewTreeObserver().isAlive()) getViewTreeObserver().removeOnGlobalLayoutListener(connectKeyboardLayout);','');
 }
 const anchor='public RNCWebView(ThemedReactContext reactContext) {\n        super(reactContext);';
 if(!source.includes(anchor)||!source.includes('public void destroy() {'))throw Error('Connect keyboard: upstream WebView lifecycle changed');
 const fields=`
    // CONNECT_VISIBLE_VIEWPORT_V2: physical IME occlusion, also on Android 10.
    private int connectVisibleHeight = -1;
    private int connectVisibleWidth = -1;
    private final android.view.ViewTreeObserver.OnGlobalLayoutListener connectKeyboardLayout = () -> {
        if (getHeight() <= 0 || getWidth() <= 0 || !isAttachedToWindow()) return;
        android.graphics.Rect frame = new android.graphics.Rect();
        getWindowVisibleDisplayFrame(frame);
        int[] position = new int[2]; getLocationOnScreen(position);
        int available = Math.max(0, Math.min(getHeight(), frame.bottom - position[1]));
        if (android.os.Build.VERSION.SDK_INT >= 30 && getRootWindowInsets() != null) {
            int ime = getRootWindowInsets().getInsets(android.view.WindowInsets.Type.ime()).bottom;
            android.app.Activity activity = getThemedReactContext().getCurrentActivity();
            if (ime > 0 && activity != null) {
                int keyboardTop = activity.getWindowManager().getCurrentWindowMetrics().getBounds().bottom - ime;
                available = Math.max(0, Math.min(available, keyboardTop - position[1]));
            }
        }
        if (available <= 0 || (available == connectVisibleHeight && getWidth() == connectVisibleWidth)) return;
        connectVisibleHeight = available; connectVisibleWidth = getWidth();
        double height = available / (double)getResources().getDisplayMetrics().density;
        evaluateJavascript("window.__CONNECT_ANDROID_VIEWPORT__={height:" + height + ",top:0};window.dispatchEvent(new Event('connect:android-viewport'));true;", null);
    };
`;
 source=source.replace(anchor,fields+'\n    '+anchor+'\n        getViewTreeObserver().addOnGlobalLayoutListener(connectKeyboardLayout);');
 source=source.replace('public void destroy() {','public void destroy() {\n        if (getViewTreeObserver().isAlive()) getViewTreeObserver().removeOnGlobalLayoutListener(connectKeyboardLayout);');
 return source;
}
function apply(project){const file=path.join(project,'node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebView.java');const source=fs.readFileSync(file,'utf8'),result=patch(source);if(result!==source)fs.writeFileSync(file,result);}
module.exports=function(config){return withDangerousMod(config,['android',async mod=>{apply(mod.modRequest.projectRoot);return mod;}]);};
module.exports.patch=patch;module.exports.apply=apply;
