# Life Partner Pro (STEP 37) - release shrinking rules.
# Capacitor and its plugins ship their own consumer rules; these keep the web view bridge working after obfuscation.
-keepattributes JavascriptInterface
-keepattributes *Annotation*
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
    @com.getcapacitor.PluginMethod public <methods>;
}
# Keep line numbers for crash reports (the mapping file is uploaded with the build and never shipped).
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile