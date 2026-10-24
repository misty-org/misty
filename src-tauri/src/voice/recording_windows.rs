//! Windows screen recording: Windows.Graphics.Capture frames into a Media
//! Foundation sink writer (H.264 in an .mp4). System audio (without Misty)
//! and, when asked, the microphone come from audeeo-core as two AAC tracks.
use audeeo_core::{AudioSource, Capture, PcmChunk, Resampler};
use std::path::Path;
use std::sync::{Arc, Mutex};
use windows::core::{Interface, BOOL, HSTRING};
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::{HMODULE, LPARAM, RECT};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_CPU_ACCESS_READ,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, MonitorFromPoint, HDC, HMONITOR, MONITOR_DEFAULTTOPRIMARY,
};
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

mod writer;
use writer::{add_audio, add_video, write, write_frame};

const FPS: u32 = 30;
const AUDIO_RATE: u32 = 48_000;
/// Media Foundation time is in 100 ns units.
const HNS: i64 = 10_000_000;

struct Writer {
    sink: IMFSinkWriter,
    video: u32,
    width: u32,
    height: u32,
    first: Option<i64>,
    last: i64,
}

// The sink writer is a free-threaded COM object, used only under the mutex.
unsafe impl Send for Writer {}

struct Running {
    writer: Arc<Mutex<Writer>>,
    session: GraphicsCaptureSession,
    pool: Direct3D11CaptureFramePool,
    audio: Vec<Capture>,
}

// The WinRT objects are agile; they are only touched under this lock.
unsafe impl Send for Running {}

fn running() -> &'static Mutex<Option<Running>> {
    static RUNNING: Mutex<Option<Running>> = Mutex::new(None);
    &RUNNING
}

fn message(error: windows::core::Error) -> String {
    format!("The screen couldn't be recorded ({:#x}).", error.code().0)
}

fn monitor(index: Option<u32>) -> HMONITOR {
    unsafe extern "system" fn collect(
        monitor: HMONITOR,
        _: HDC,
        _: *mut RECT,
        list: LPARAM,
    ) -> BOOL {
        (*(list.0 as *mut Vec<HMONITOR>)).push(monitor);
        true.into()
    }
    let mut monitors: Vec<HMONITOR> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(
            None,
            None,
            Some(collect),
            LPARAM(&mut monitors as *mut _ as isize),
        );
    }
    index
        .and_then(|i| monitors.get(i as usize).copied())
        .unwrap_or_else(|| unsafe {
            MonitorFromPoint(Default::default(), MONITOR_DEFAULTTOPRIMARY)
        })
}

fn audio_track(
    writer: Arc<Mutex<Writer>>,
    stream: u32,
    source: AudioSource,
) -> Result<Capture, String> {
    let resampler = Mutex::new(Resampler::to_rate(16_000, 1, AUDIO_RATE));
    let written = Mutex::new(0i64);
    audeeo_core::start(
        source,
        move |chunk: PcmChunk| {
            let mut out = Vec::new();
            if let Ok(mut resampler) = resampler.lock() {
                resampler.push_i16(&chunk.samples, &mut out);
            }
            let (Ok(writer), Ok(mut frames)) = (writer.lock(), written.lock()) else {
                return;
            };
            // Audio waits for the first picture, so the file starts on it.
            if writer.first.is_none() || out.is_empty() {
                return;
            }
            let bytes: Vec<u8> = out.iter().flat_map(|s| s.to_le_bytes()).collect();
            let time = *frames * HNS / AUDIO_RATE as i64;
            *frames += out.len() as i64;
            let _ = write(
                &writer.sink,
                stream,
                &bytes,
                time,
                out.len() as i64 * HNS / AUDIO_RATE as i64,
            );
        },
        |_| {},
    )
    .map_err(|error| error.to_string())
}

pub fn start(path: &Path, display: Option<u32>, microphone: bool) -> Result<(), String> {
    let mut slot = running().lock().map_err(|_| "Recording is busy.")?;
    if slot.is_some() {
        return Err("A recording is already running.".into());
    }
    if !GraphicsCaptureSession::IsSupported().unwrap_or(false) {
        return Err("Recording the screen needs Windows 10 version 1903 or later.".into());
    }
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        MFStartup(MF_VERSION, MFSTARTUP_FULL).map_err(message)?;
    }
    let (device, context) = unsafe {
        let (mut device, mut context) = (None, None);
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
        .map_err(message)?;
        (
            device.ok_or("No graphics device.")?,
            context.ok_or("No graphics device.")?,
        )
    };
    let direct3d: IDirect3DDevice = unsafe {
        CreateDirect3D11DeviceFromDXGIDevice(&device.cast::<IDXGIDevice>().map_err(message)?)
            .map_err(message)?
            .cast()
            .map_err(message)?
    };
    let item: GraphicsCaptureItem = unsafe {
        windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
            .map_err(message)?
            .CreateForMonitor(monitor(display))
            .map_err(message)?
    };
    let size = item.Size().map_err(message)?;
    let (width, height) = (
        (size.Width.max(2) as u32) & !1,
        (size.Height.max(2) as u32) & !1,
    );

    let sink = unsafe {
        MFCreateSinkWriterFromURL(&HSTRING::from(path.as_os_str()), None, None).map_err(message)?
    };
    let video = add_video(&sink, width, height).map_err(message)?;
    let system_track = add_audio(&sink).map_err(message)?;
    let mic_track = if microphone {
        Some(add_audio(&sink).map_err(message)?)
    } else {
        None
    };
    unsafe { sink.BeginWriting().map_err(message)? };
    let writer = Arc::new(Mutex::new(Writer {
        sink,
        video,
        width,
        height,
        first: None,
        last: 0,
    }));

    let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
        &direct3d,
        DirectXPixelFormat::B8G8R8A8UIntNormalized,
        2,
        size,
    )
    .map_err(message)?;
    let frames = writer.clone();
    pool.FrameArrived(&TypedEventHandler::<
        Direct3D11CaptureFramePool,
        windows::core::IInspectable,
    >::new(move |pool, _| {
        if let Some(pool) = pool.as_ref() {
            let _ = write_frame(&device, &context, &frames, pool);
        }
        Ok(())
    }))
    .map_err(message)?;
    let session = pool.CreateCaptureSession(&item).map_err(message)?;
    let _ = session.SetIsCursorCaptureEnabled(true);
    let mut audio = vec![audio_track(
        writer.clone(),
        system_track,
        AudioSource::System { exclude_self: true },
    )?];
    if let Some(track) = mic_track {
        audio.push(audio_track(writer.clone(), track, AudioSource::Mic)?);
    }
    session.StartCapture().map_err(message)?;
    *slot = Some(Running {
        writer,
        session,
        pool,
        audio,
    });
    Ok(())
}

/// Stops and closes the file; returns its length in seconds.
pub fn stop() -> Result<f64, String> {
    let current = running()
        .lock()
        .map_err(|_| "Recording is busy.")?
        .take()
        .ok_or("Nothing is being recorded.")?;
    let _ = current.session.Close();
    let _ = current.pool.Close();
    for capture in current.audio {
        capture.stop();
    }
    let writer = current.writer.lock().map_err(|_| "Recording is busy.")?;
    if writer.first.is_none() {
        return Err("Nothing was recorded.".into());
    }
    unsafe { writer.sink.Finalize().map_err(message)? };
    let _ = unsafe { MFShutdown() };
    Ok(writer.last as f64 / HNS as f64)
}
