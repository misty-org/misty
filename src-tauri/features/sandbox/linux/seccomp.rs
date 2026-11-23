use libc::{sock_filter, sock_fprog};

const BPF_LD_W_ABS: u16 = 0x00 | 0x00 | 0x20;
const BPF_JMP_JEQ_K: u16 = 0x05 | 0x10;
const BPF_JMP_JGE_K: u16 = 0x05 | 0x30;
const BPF_JMP_JSET_K: u16 = 0x05 | 0x40;
const BPF_RET_K: u16 = 0x06;

const RET_ALLOW: u32 = 0x7fff_0000;
const RET_ERRNO: u32 = 0x0005_0000;
const RET_KILL_PROCESS: u32 = 0x8000_0000;

#[cfg(target_arch = "x86_64")]
const AUDIT_ARCH: u32 = 0xc000_003e;
#[cfg(target_arch = "aarch64")]
const AUDIT_ARCH: u32 = 0xc000_00b7;

const NR: u32 = 0;
const ARCH: u32 = 4;
const fn arg(n: u32) -> u32 {
    16 + 8 * n
}

const CLONE_NAMESPACES: u32 = (libc::CLONE_NEWNS
    | libc::CLONE_NEWCGROUP
    | libc::CLONE_NEWUTS
    | libc::CLONE_NEWIPC
    | libc::CLONE_NEWUSER
    | libc::CLONE_NEWPID
    | libc::CLONE_NEWNET) as u32;

const REFUSED: &[libc::c_long] = &[
    libc::SYS_socket,
    libc::SYS_io_uring_setup,
    libc::SYS_io_uring_enter,
    libc::SYS_io_uring_register,
    libc::SYS_bpf,
    libc::SYS_perf_event_open,
    libc::SYS_userfaultfd,
    libc::SYS_keyctl,
    libc::SYS_add_key,
    libc::SYS_request_key,
    libc::SYS_mount,
    libc::SYS_umount2,
    libc::SYS_pivot_root,
    libc::SYS_chroot,
    libc::SYS_fsopen,
    libc::SYS_fsmount,
    libc::SYS_fspick,
    libc::SYS_move_mount,
    libc::SYS_open_tree,
    libc::SYS_mount_setattr,
    libc::SYS_swapon,
    libc::SYS_swapoff,
    libc::SYS_reboot,
    libc::SYS_kexec_load,
    libc::SYS_kexec_file_load,
    libc::SYS_init_module,
    libc::SYS_finit_module,
    libc::SYS_delete_module,
    libc::SYS_acct,
    libc::SYS_unshare,
    libc::SYS_setns,
    libc::SYS_open_by_handle_at,
    libc::SYS_name_to_handle_at,
    libc::SYS_fanotify_init,
    libc::SYS_syslog,
    libc::SYS_quotactl,
    libc::SYS_vhangup,
    libc::SYS_ptrace,
    libc::SYS_process_vm_readv,
    libc::SYS_process_vm_writev,
    libc::SYS_process_madvise,
    libc::SYS_kcmp,
    libc::SYS_pidfd_getfd,
    #[cfg(target_arch = "x86_64")]
    libc::SYS_iopl,
    #[cfg(target_arch = "x86_64")]
    libc::SYS_ioperm,
    #[cfg(target_arch = "x86_64")]
    libc::SYS_modify_ldt,
    #[cfg(target_arch = "x86_64")]
    libc::SYS_uselib,
];

const REACHING_OTHERS: &[libc::c_long] = &[
    libc::SYS_tkill,
    libc::SYS_rt_sigqueueinfo,
    libc::SYS_rt_tgsigqueueinfo,
    libc::SYS_pidfd_send_signal,
    libc::SYS_pidfd_open,
];

pub(super) struct Shape {
    pub forks: bool,
    pub contain_signals: bool,
}

#[derive(Clone)]
pub(super) struct Filter {
    program: Vec<sock_filter>,
    patches: Vec<(usize, Patch)>,
}

#[derive(Clone, Copy)]
enum Patch {
    Leader,
    Group,
}

fn statement(code: u16, k: u32) -> sock_filter {
    sock_filter {
        code,
        jt: 0,
        jf: 0,
        k,
    }
}

fn jump(code: u16, k: u32, jt: u8, jf: u8) -> sock_filter {
    sock_filter { code, jt, jf, k }
}

impl Filter {
    pub(super) fn build(shape: &Shape) -> Self {
        let mut filter = Self {
            program: Vec::new(),
            patches: Vec::new(),
        };
        let errno = |code: i32| statement(BPF_RET_K, RET_ERRNO | code as u32);
        let eperm = errno(libc::EPERM);
        let p = &mut filter.program;
        p.push(statement(BPF_LD_W_ABS, ARCH));
        p.push(jump(BPF_JMP_JEQ_K, AUDIT_ARCH, 1, 0));
        p.push(statement(BPF_RET_K, RET_KILL_PROCESS));
        p.push(statement(BPF_LD_W_ABS, NR));
        #[cfg(target_arch = "x86_64")]
        {
            p.push(jump(BPF_JMP_JGE_K, 0x4000_0000, 0, 1));
            p.push(errno(libc::ENOSYS));
        }
        for number in REFUSED {
            p.push(jump(BPF_JMP_JEQ_K, *number as u32, 0, 1));
            p.push(eperm);
        }
        p.push(jump(BPF_JMP_JEQ_K, libc::SYS_clone3 as u32, 0, 1));
        p.push(errno(libc::ENOSYS));
        p.push(jump(
            BPF_JMP_JEQ_K,
            libc::SYS_clone as u32,
            0,
            if shape.forks { 4 } else { 6 },
        ));
        p.push(statement(BPF_LD_W_ABS, arg(0)));
        p.push(jump(BPF_JMP_JSET_K, CLONE_NAMESPACES, 0, 1));
        p.push(eperm);
        if !shape.forks {
            p.push(jump(BPF_JMP_JSET_K, libc::CLONE_THREAD as u32, 1, 0));
            p.push(eperm);
        }
        p.push(statement(BPF_RET_K, RET_ALLOW));
        #[cfg(target_arch = "x86_64")]
        if !shape.forks {
            for number in [libc::SYS_fork, libc::SYS_vfork] {
                p.push(jump(BPF_JMP_JEQ_K, number as u32, 0, 1));
                p.push(eperm);
            }
        }
        p.push(jump(BPF_JMP_JEQ_K, libc::SYS_ioctl as u32, 0, 5));
        p.push(statement(BPF_LD_W_ABS, arg(1)));
        p.push(jump(BPF_JMP_JEQ_K, libc::TIOCSTI as u32, 1, 0));
        p.push(jump(BPF_JMP_JEQ_K, libc::TIOCLINUX as u32, 0, 1));
        p.push(eperm);
        p.push(statement(BPF_RET_K, RET_ALLOW));
        if shape.contain_signals {
            for number in REACHING_OTHERS {
                p.push(jump(BPF_JMP_JEQ_K, *number as u32, 0, 1));
                p.push(eperm);
            }
            p.push(jump(BPF_JMP_JEQ_K, libc::SYS_kill as u32, 0, 5));
            p.push(statement(BPF_LD_W_ABS, arg(0)));
            p.push(jump(BPF_JMP_JEQ_K, 0, 2, 0));
            let group = p.len();
            p.push(jump(BPF_JMP_JEQ_K, 0, 1, 0));
            p.push(eperm);
            p.push(statement(BPF_RET_K, RET_ALLOW));
            filter.patches.push((group, Patch::Group));
            let p = &mut filter.program;
            p.push(jump(BPF_JMP_JEQ_K, libc::SYS_tgkill as u32, 0, 4));
            p.push(statement(BPF_LD_W_ABS, arg(0)));
            let leader = p.len();
            p.push(jump(BPF_JMP_JEQ_K, 0, 1, 0));
            p.push(eperm);
            p.push(statement(BPF_RET_K, RET_ALLOW));
            filter.patches.push((leader, Patch::Leader));
            for number in [libc::SYS_prlimit64, libc::SYS_sched_setaffinity] {
                p.push(jump(BPF_JMP_JEQ_K, number as u32, 0, 4));
                p.push(statement(BPF_LD_W_ABS, arg(0)));
                p.push(jump(BPF_JMP_JEQ_K, 0, 0, 1));
                p.push(statement(BPF_RET_K, RET_ALLOW));
                p.push(eperm);
            }
            p.push(jump(BPF_JMP_JEQ_K, libc::SYS_setpriority as u32, 0, 6));
            p.push(statement(BPF_LD_W_ABS, arg(0)));
            p.push(jump(BPF_JMP_JEQ_K, 0, 0, 3));
            p.push(statement(BPF_LD_W_ABS, arg(1)));
            p.push(jump(BPF_JMP_JEQ_K, 0, 0, 1));
            p.push(statement(BPF_RET_K, RET_ALLOW));
            p.push(eperm);
        }
        filter.program.push(statement(BPF_RET_K, RET_ALLOW));
        filter
    }

    pub(super) fn install(&mut self, leader: libc::pid_t) -> std::io::Result<()> {
        for (index, patch) in &self.patches {
            let value = match patch {
                Patch::Leader => leader,
                Patch::Group => leader.wrapping_neg(),
            };
            self.program[*index].k = value as u32;
        }
        let program = sock_fprog {
            len: self.program.len() as u16,
            filter: self.program.as_mut_ptr(),
        };
        // SAFETY: a valid program that outlives the call; the kernel copies it.
        let installed = unsafe {
            libc::prctl(
                libc::PR_SET_SECCOMP,
                libc::SECCOMP_MODE_FILTER as libc::c_ulong,
                &program as *const sock_fprog,
                0,
                0,
            )
        };
        if installed != 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn well_formed(filter: &Filter) {
        let program = &filter.program;
        for (index, instruction) in program.iter().enumerate() {
            if instruction.code & 0x07 == 0x05 {
                assert!(index + 1 + (instruction.jt as usize) < program.len());
                assert!(index + 1 + (instruction.jf as usize) < program.len());
            }
        }
        assert_eq!(program.last().unwrap().code, BPF_RET_K);
    }

    #[test]
    fn every_shape_is_well_formed() {
        for forks in [false, true] {
            for contain_signals in [false, true] {
                well_formed(&Filter::build(&Shape {
                    forks,
                    contain_signals,
                }));
            }
        }
    }
}
