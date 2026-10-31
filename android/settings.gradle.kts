pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "SubwayRunner"
// The delivered game is WebGL/WebView. Preserve the legacy Godot plugin source,
// but do not package that incompatible, earlier prototype library in this app.
include(":app")
