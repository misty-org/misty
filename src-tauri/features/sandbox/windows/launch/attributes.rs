use super::*;

pub(super) struct Inheritable<'a>(&'a [HANDLE]);

impl<'a> Inheritable<'a> {
    pub(super) fn new(handles: &'a [HANDLE]) -> Result<Self, String> {
        for (index, &handle) in handles.iter().enumerate() {
            // SAFETY: live handles owned by the caller.
            if unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) }
                == 0
            {
                drop(Self(&handles[..index]));
                return Err("Could not start the command.".into());
            }
        }
        Ok(Self(handles))
    }
}

impl Drop for Inheritable<'_> {
    fn drop(&mut self) {
        for &handle in self.0 {
            // SAFETY: as above.
            unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0) };
        }
    }
}

pub(super) struct Attributes {
    buffer: Vec<u8>,
}

impl Attributes {
    pub(super) fn new(count: u32) -> Result<Self, String> {
        let mut size = 0usize;
        // SAFETY: a size query with no buffer.
        unsafe { InitializeProcThreadAttributeList(ptr::null_mut(), count, 0, &mut size) };
        let mut buffer = vec![0u8; size];
        // SAFETY: `buffer` has the size Windows asked for.
        if unsafe {
            InitializeProcThreadAttributeList(buffer.as_mut_ptr().cast(), count, 0, &mut size)
        } == 0
        {
            return Err("Could not start the command.".into());
        }
        Ok(Self { buffer })
    }

    pub(super) fn list(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.buffer.as_mut_ptr().cast()
    }

    pub(super) unsafe fn set<T>(
        &mut self,
        attribute: usize,
        value: *const T,
        size: usize,
    ) -> Result<(), String> {
        if UpdateProcThreadAttribute(
            self.list(),
            0,
            attribute,
            value.cast(),
            size,
            ptr::null_mut(),
            ptr::null(),
        ) == 0
        {
            return Err("Could not start the command.".into());
        }
        Ok(())
    }
}

impl Drop for Attributes {
    fn drop(&mut self) {
        // SAFETY: initialized in `new`.
        unsafe { DeleteProcThreadAttributeList(self.list()) };
    }
}
