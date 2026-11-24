package yapper

class MicrophoneIntent {
    var enabled = false
        private set
    var revision = 0L
        private set

    fun update(enabled: Boolean) {
        this.enabled = enabled
        revision++
    }
}
