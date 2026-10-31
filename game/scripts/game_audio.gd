extends Node
class_name RunnerAudio

var music_enabled := true
var sfx_enabled := true
var _music: AudioStreamPlayer
var _players: Array[AudioStreamPlayer] = []
var _sounds: Dictionary = {}
var _cursor := 0
const RATE := 22050

func setup() -> void:
	_music = AudioStreamPlayer.new()
	_music.volume_db = -23.0
	_music.stream = _music_loop()
	add_child(_music)
	for i in 5:
		var player := AudioStreamPlayer.new()
		player.volume_db = -15.0
		add_child(player)
		_players.append(player)
	_sounds = {
		"coin": _tone(880.0, 0.09, 1.6), "jump": _tone(260.0, 0.15, 2.0),
		"slide": _tone(200.0, 0.14, 0.5), "crash": _tone(110.0, 0.35, 0.3),
		"powerup": _tone(620.0, 0.22, 2.0), "shield": _tone(440.0, 0.20, 1.5)
	}

func configure(settings: Dictionary) -> void:
	music_enabled = bool(settings.get("music", true))
	sfx_enabled = bool(settings.get("sfx", true))
	if not music_enabled and is_instance_valid(_music):
		_music.stop()

func set_running(running: bool) -> void:
	if music_enabled and running:
		if not _music.playing:
			_music.play()
	elif _music.playing:
		_music.stop()

func effect(kind: String) -> void:
	if not sfx_enabled or not _sounds.has(kind):
		return
	var player := _players[_cursor % _players.size()]
	_cursor += 1
	player.stream = _sounds[kind]
	player.play()

func _tone(frequency: float, seconds: float, sweep: float) -> AudioStreamWAV:
	var count := int(RATE * seconds)
	var pcm := PackedByteArray()
	pcm.resize(count * 2)
	for i in count:
		var t := float(i) / RATE
		var f := lerpf(frequency, frequency * sweep, float(i) / count)
		var env := pow(1.0 - float(i) / count, 2.0) * minf(1.0, t * 150.0)
		pcm.encode_s16(i * 2, int(sin(TAU * f * t) * env * 13000.0))
	return _wav(pcm)

func _music_loop() -> AudioStreamWAV:
	var beat := 0.32
	var seconds := beat * 16.0
	var notes := [261.63, 329.63, 392.0, 523.25, 440.0, 392.0, 329.63, 293.66]
	var count := int(RATE * seconds)
	var pcm := PackedByteArray()
	pcm.resize(count * 2)
	for i in count:
		var t := float(i) / RATE
		var beat_phase := fposmod(t, beat)
		var index := int(t / beat)
		var f: float = notes[index % notes.size()]
		var env := exp(-beat_phase * 13.0) * minf(1.0, beat_phase * 200.0)
		var note := sin(TAU * f * t) * env * 0.40
		var bass := sin(TAU * 65.407 * t) * exp(-beat_phase * 10.0) * 0.22
		var kick := sin(TAU * (70.0 - minf(beat_phase, 0.15) * 230.0) * beat_phase) * exp(-beat_phase * 28.0) * 0.26
		pcm.encode_s16(i * 2, int((note + bass + kick) * 18000.0))
	var stream := _wav(pcm)
	stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
	stream.loop_end = count
	return stream

func _wav(pcm: PackedByteArray) -> AudioStreamWAV:
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = RATE
	stream.stereo = false
	stream.data = pcm
	return stream
