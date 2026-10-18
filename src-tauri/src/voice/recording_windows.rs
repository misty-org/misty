//! Windows screen recording: Windows.Graphics.Capture frames into a Media
//! Foundation sink writer (H.264 in an .mp4). System audio (without Misty)
//! and, when asked, the microphone come from audeeo-core as two AAC tracks.
use audeeo_core::{AudioSource, Capture, PcmChunk, Resampler};
use std::path::Path;
use std::sync::{Arc, Mutex};
use windows::core::{Interface, BOOL, HSTRING};
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::{HMODULE, LPARAM, RECT};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
    D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, MonitorFromPoint, HDC, HMONITOR, MONITOR_DEFAULTTOPRIMARY};
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

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
    unsafe extern "system" fn collect(monitor: HMONITOR, _: HDC, _: *mut RECT, list: LPARAM) -> BOOL {
        (*(list.0 as *mut Vec<HMONITOR>)).push(monitor);
        true.into()
    }
    let mut monitors: Vec<HMONITOR> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(collect), LPARAM(&mut monitors as *mut _ as isize));
    }
    index
        .and_then(|i| monitors.get(i as usize).copied())
        .unwrap_or_else(|| unsafe { MonitorFromPoint(Default::default(), MONITOR_DEFAULTTOPRIMARY) })
}

fn media_type(major: &windows::core::GUID, subtype: &windows::core::GUID) -> windows::core::Result<IMFMediaType> {
    unsafe {
        let media = MFCreateMediaType()?;
        media.SetGUID(&MF_MT_MAJOR_TYPE, major)?;
        media.SetGUID(&MF_MT_SUBTYPE, subtype)?;
        Ok(media)
    }
}

fn pack(high: u32, low: u32) -> u64 {
    ((high as u64) << 32) | low as u64
}

fn add_video(sink: &IMFSinkWriter, width: u32, height: u32) -> windows::core::Result<u32> {
    unsafe {
        let output = media_type(&MFMediaType_Video, &MFVideoFormat_H264)?;
        output.SetUINT32(&MF_MT_AVG_BITRATE, (width * height).min(2_500_000))?;
        output.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
        output.SetUINT64(&MF_MT_FRAME_SIZE, pack(width, height))?;
        output.SetUINT64(&MF_MT_FRAME_RATE, pack(FPS, 1))?;
        output.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1))?;
        let stream = sink.AddStream(&output)?;
        let input = media_type(&MFMediaType_Video, &MFVideoFormat_RGB32)?;
        input.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
        input.SetUINT64(&MF_MT_FRAME_SIZE, pack(width, height))?;
        input.SetUINT64(&MF_MT_FRAME_RATE, pack(FPS, 1))?;
        input.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1))?;
        // Positive stride: rows are top-down, as the capture delivers them.
        input.SetUINT32(&MF_MT_DEFAULT_STRIDE, width * 4)?;
        sink.SetInputMediaType(stream, &input, None)?;
        Ok(stream)
    }
}

fn add_audio(sink: &IMFSinkWriter) -> windows::core::Result<u32> {
    unsafe {
        let output = media_type(&MFMediaType_Audio, &MFAudioFormat_AAC)?;
        output.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
        output.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, AUDIO_RATE)?;
        output.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, 1)?;
        output.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 12_000)?;
        let stream = sink.AddStream(&output)?;
        let input = media_type(&MFMediaType_Audio, &MFAudioFormat_PCM)?;
        input.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
        input.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, AUDIO_RATE)?;
        input.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, 1)?;
        input.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, 2)?;
        input.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, AUDIO_RATE * 2)?;
        sink.SetInputMediaType(stream, &input, None)?;
        Ok(stream)
    }
}

fn write(sink: &IMFSinkWriter, stream: u32, bytes: &[u8], time: i64, duration: i64) -> windows::core::Result<()> {
    unsafe {
        let buffer = MFCreateMemoryBuffer(bytes.len() as u32)?;
        let mut data = std::ptr::null_mut();
        buffer.Lock(&mut data, None, None)?;
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), data, bytes.len());
        buffer.Unlock()?;
        buffer.SetCurrentLength(bytes.len() as u32)?;
        let sample = MFCreateSample()?;
        sample.AddBuffer(&buffer)?;
        sample.SetSampleTime(time)?;
        sample.SetSampleDuration(duration)?;
        sink.WriteSample(stream, &sample)
    }
}

/// Copies one captured frame through a CPU-readable texture into the file.
fn write_frame(device: &ID3D11Device, context: &ID3D11DeviceContext, writer: &Mutex<Writer>, pool: &Direct3D11CaptureFramePool) -> windows::core::Result<()> {
    let frame = pool.TryGetNextFrame()?;
    let time = frame.SystemRelativeTime()?.Duration;
    let texture: ID3D11Texture2D = unsafe { frame.Surface()?.cast::<IDirect3DDxgiInterfaceAccess>()?.GetInterface()? };
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { texture.GetDesc(&mut desc) };
    let mut writer = writer.lock().map_err(|_| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))?;
    let (width, height) = (writer.width, writer.height);
    desc.Usage = D3D11_USAGE_STAGING;
    desc.BindFlags = 0;
    desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
    desc.MiscFlags = 0;
    let mut staging = None;
    unsafe { device.CreateTexture2D(&desc, None, Some(&mut staging))? };
    let staging = staging.ok_or_else(|| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))?;
    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    let mut pixels = vec![0u8; (width * height * 4) as usize];
    unsafe {
        context.CopyResource(&staging, &texture);
        context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
        // A display that changed size is cropped or padded to the file's size.
        let rows = height.min(desc.Height) as usize;
        let row = (width.min(desc.Width) * 4) as usize;
        for y in 0..rows {
            let source = (mapped.pData as *const u8).add(y * mapped.RowPitch as usize);
            std::ptr::copy_nonoverlapping(source, pixels.as_mut_ptr().add(y * (width * 4) as usize), row);
        }
        context.Unmap(&staging, 0);
    }
    let first = *writer.first.get_or_insert(time);
    writer.last = time - first;
    let stream = writer.video;
    write(&writer.sink, stream, &pixels, time - first, HNS / FPS as i64)
}

fn audio_track(writer: Arc<Mutex<Writer>>, stream: u32, source: AudioSource) -> Result<Capture, String> {
    let resampler = Mutex::new(Resampler::to_rate(16_000, 1, AUDIO_RATE));
    let written = Mutex::new(0i64);
    audeeo_core::start(
        source,
        move |chunk: PcmChunk| {
            let mut out = Vec::new();
            if let Ok(mut resampler) = resampler.lock() {
                resampler.push_i16(&chunk.samples, &mut out);
            }
            let (Ok(writer), Ok(mut frames)) = (writer.lock(), written.lock()) else { return };
            // Audio waits for the first picture, so the file starts on it.
            if writer.first.is_none() || out.is_empty() {
                return;
            }
            let bytes: Vec<u8> = out.iter().flat_map(|s| s.to_le_bytes()).collect();
            let time = *frames * HNS / AUDIO_RATE as i64;
            *frames += out.len() as i64;
            let _ = write(&writer.sink, stream, &bytes, time, out.len() as i64 * HNS / AUDIO_RATE as i64);
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
        D3D11CreateDevice(None, D3D_DRIVER_TYPE_HARDWARE, HMODULE::default(), D3D11_CREATE_DEVICE_BGRA_SUPPORT, None, D3D11_SDK_VERSION, Some(&mut device), None, Some(&mut context))
            .map_err(message)?;
        (device.ok_or("No graphics device.")?, context.ok_or("No graphics device.")?)
    };
    let direct3d: IDirect3DDevice = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&device.cast::<IDXGIDevice>().map_err(message)?).map_err(message)?.cast().map_err(message)? };
    let item: GraphicsCaptureItem = unsafe { windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>().map_err(message)?.CreateForMonitor(monitor(display)).map_err(message)? };
    let size = item.Size().map_err(message)?;
    let (width, height) = ((size.Width.max(2) as u32) & !1, (size.Height.max(2) as u32) & !1);

    let sink = unsafe { MFCreateSinkWriterFromURL(&HSTRING::from(path.as_os_str()), None, None).map_err(message)? };
    let video = add_video(&sink, width, height).map_err(message)?;
    let system_track = add_audio(&sink).map_err(message)?;
    let mic_track = if microphone { Some(add_audio(&sink).map_err(message)?) } else { None };
    unsafe { sink.BeginWriting().map_err(message)? };
    let writer = Arc::new(Mutex::new(Writer { sink, video, width, height, first: None, last: 0 }));

    let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&direct3d, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size).map_err(message)?;
    let frames = writer.clone();
    pool.FrameArrived(&TypedEventHandler::<Direct3D11CaptureFramePool, windows::core::IInspectable>::new(move |pool, _| {
        if let Some(pool) = pool.as_ref() {
            let _ = write_frame(&device, &context, &frames, pool);
        }
        Ok(())
    }))
    .map_err(message)?;
    let session = pool.CreateCaptureSession(&item).map_err(message)?;
    let _ = session.SetIsCursorCaptureEnabled(true);
    let mut audio = vec![audio_track(writer.clone(), system_track, AudioSource::System { exclude_self: true })?];
    if let Some(track) = mic_track {
        audio.push(audio_track(writer.clone(), track, AudioSource::Mic)?);
    }
    session.StartCapture().map_err(message)?;
    *slot = Some(Running { writer, session, pool, audio });
    Ok(())
}

/// Stops and closes the file; returns its length in seconds.
pub fn stop() -> Result<f64, String> {
    let current = running().lock().map_err(|_| "Recording is busy.")?.take().ok_or("Nothing is being recorded.")?;
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
