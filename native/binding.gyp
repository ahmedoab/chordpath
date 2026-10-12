{
  # ChordPath's native audio host: loads VST 3 plugins, mixes the tracks that
  # pass through them and talks to sound cards. Windows only for now. The
  # third-party sources come from native/deps, which fetch-deps.js fills.
  "targets": [
    {
      # RtAudio, for playing through Windows' own sound system (WASAPI). ASIO
      # drivers are spoken to directly instead: see src/asiohost.cpp.
      "target_name": "rtaudio",
      "type": "static_library",
      "sources": ["deps/rtaudio/RtAudio.cpp"],
      "include_dirs": ["deps/rtaudio", "deps/rtaudio/include"],
      "defines": ["__WINDOWS_WASAPI__", "NOMINMAX", "_CRT_SECURE_NO_WARNINGS"],
      "msvs_settings": {
        "VCCLCompilerTool": { "ExceptionHandling": 1, "AdditionalOptions": ["/std:c++17"], "WarningLevel": 1 }
      }
    },
    {
      "target_name": "chordpath_native",
      "dependencies": ["rtaudio"],
      "sources": [
        "src/addon.cpp",
        "src/hostthread.cpp",
        "src/vsthost.cpp",
        "src/dsp.cpp",
        "src/mixer.cpp",
        "src/asiohost.cpp",
        "src/audio.cpp",

        "deps/vst3sdk/public.sdk/source/vst/hosting/module.cpp",
        "deps/vst3sdk/public.sdk/source/vst/hosting/module_win32.cpp",
        "deps/vst3sdk/public.sdk/source/vst/hosting/hostclasses.cpp",
        "deps/vst3sdk/public.sdk/source/vst/hosting/plugprovider.cpp",
        "deps/vst3sdk/public.sdk/source/vst/hosting/connectionproxy.cpp",
        "deps/vst3sdk/public.sdk/source/vst/hosting/eventlist.cpp",
        "deps/vst3sdk/public.sdk/source/vst/hosting/parameterchanges.cpp",
        "deps/vst3sdk/public.sdk/source/vst/hosting/processdata.cpp",
        "deps/vst3sdk/public.sdk/source/vst/hosting/pluginterfacesupport.cpp",
        "deps/vst3sdk/public.sdk/source/vst/utility/stringconvert.cpp",
        "deps/vst3sdk/public.sdk/source/vst/vstinitiids.cpp",
        "deps/vst3sdk/public.sdk/source/common/memorystream.cpp",
        "deps/vst3sdk/public.sdk/source/common/commoniids.cpp",
        "deps/vst3sdk/public.sdk/source/common/commonstringconvert.cpp",
        "deps/vst3sdk/public.sdk/source/common/threadchecker_win32.cpp",

        "deps/vst3sdk/base/source/baseiids.cpp",
        "deps/vst3sdk/base/source/fbuffer.cpp",
        "deps/vst3sdk/base/source/fdebug.cpp",
        "deps/vst3sdk/base/source/fdynlib.cpp",
        "deps/vst3sdk/base/source/fobject.cpp",
        "deps/vst3sdk/base/source/fstreamer.cpp",
        "deps/vst3sdk/base/source/fstring.cpp",
        "deps/vst3sdk/base/source/timer.cpp",
        "deps/vst3sdk/base/source/updatehandler.cpp",
        "deps/vst3sdk/base/thread/source/fcondition.cpp",
        "deps/vst3sdk/base/thread/source/flock.cpp",

        "deps/vst3sdk/pluginterfaces/base/conststringtable.cpp",
        "deps/vst3sdk/pluginterfaces/base/coreiids.cpp",
        "deps/vst3sdk/pluginterfaces/base/funknown.cpp",
        "deps/vst3sdk/pluginterfaces/base/ustring.cpp"
      ],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include_dir\")",
        "deps/vst3sdk",
        "deps/rtaudio",
        "deps/rtaudio/include",
        "src"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "NAPI_CPP_EXCEPTIONS",
        "RELEASE=1",
        "UNICODE",
        "_UNICODE",
        "NOMINMAX",
        "WIN32_LEAN_AND_MEAN",
        "_CRT_SECURE_NO_WARNINGS"
      ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": ["/std:c++17", "/utf-8", "/bigobj"],
          "WarningLevel": 2
        }
      },
      "libraries": ["ole32.lib", "shell32.lib", "user32.lib", "gdi32.lib", "winmm.lib", "ksuser.lib", "mfplat.lib", "mfuuid.lib", "wmcodecdspuuid.lib", "advapi32.lib"]
    }
  ]
}
