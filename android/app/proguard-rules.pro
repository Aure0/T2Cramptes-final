# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Keep Capacitor core bridge & plugin reflection classes under R8
-keep class com.getcapacitor.** { *; }
-keep class fr.clermont.t2clive.MainActivity { *; }
-keep class fr.clermont.t2clive.T2CWidgetProvider { *; }

# Keep WebView @JavascriptInterface bridge methods
-keepattributes *Annotation*
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve line numbers for readable crash traces
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
