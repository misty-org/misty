//! The sink writer's tracks and samples: the H.264 video track, the AAC
//! audio tracks and the frames and audio written into them.
use super::*;

fn media_type(
    major: &windows::core::GUID,
    subtype: &windows::core::GUID,
) -> windows::core::Result<IMFMediaType> {
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

pub(super) fn add_video(
    sink: &IMFSinkWriter,
    width: u32,
    height: u32,
) -> windows::core::Result<u32> {
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

pub(super) fn add_audio(sink: &IMFSinkWriter) -> windows::core::Result<u32> {
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

pub(super) fn write(
    sink: &IMFSinkWriter,
    stream: u32,
    bytes: &[u8],
    time: i64,
    duration: i64,
) -> windows::core::Result<()> {
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
pub(super) fn write_frame(
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    writer: &Mutex<Writer>,
    pool: &Direct3D11CaptureFramePool,
) -> windows::core::Result<()> {
    let frame = pool.TryGetNextFrame()?;
    let time = frame.SystemRelativeTime()?.Duration;
    let texture: ID3D11Texture2D = unsafe {
        frame
            .Surface()?
            .cast::<IDirect3DDxgiInterfaceAccess>()?
            .GetInterface()?
    };
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { texture.GetDesc(&mut desc) };
    let mut writer = writer
        .lock()
        .map_err(|_| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))?;
    let (width, height) = (writer.width, writer.height);
    desc.Usage = D3D11_USAGE_STAGING;
    desc.BindFlags = 0;
    desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
    desc.MiscFlags = 0;
    let mut staging = None;
    unsafe { device.CreateTexture2D(&desc, None, Some(&mut staging))? };
    let staging =
        staging.ok_or_else(|| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))?;
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
            std::ptr::copy_nonoverlapping(
                source,
                pixels.as_mut_ptr().add(y * (width * 4) as usize),
                row,
            );
        }
        context.Unmap(&staging, 0);
    }
    let first = *writer.first.get_or_insert(time);
    writer.last = time - first;
    let stream = writer.video;
    write(
        &writer.sink,
        stream,
        &pixels,
        time - first,
        HNS / FPS as i64,
    )
}
