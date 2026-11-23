//! How much memory Werkbank and the programs in its terminals use, each with everything it started (Claude's MCP
//! servers and shells): Task Manager's "Memory" column, the private working set. Task Manager lists the terminals'
//! programs on their own instead of under Werkbank (it only groups processes of one app package), so Werkbank shows
//! the sums itself and keeps them within a budget (ui/memory.js).

use std::collections::{HashMap, HashSet};

/// One process: its id, its parent's id, when it started (any unit that grows with time) and its memory in bytes.
pub struct Proc {
    pub pid: u32,
    pub parent: u32,
    pub started: u64,
    pub bytes: u64,
}

/// A program with everything it started.
#[derive(Debug, PartialEq, Eq)]
pub struct Tree {
    /// memory in bytes (0 for a program that is gone)
    pub bytes: u64,
    /// it runs something it started later than a minute after itself, like a command in the background: it is
    /// working even when it waits for you. MCP servers start with the program, so they do not count.
    pub busy: bool,
}

/// One minute in FILETIME ticks (100 ns), the unit of `Proc::started` on Windows.
const MINUTE: u64 = 600_000_000;

/// Each root with all its descendants. A parent id can belong to a process that ended and whose id Windows gave to
/// a newer one: a child only counts under a parent older than it.
pub fn trees(procs: &[Proc], roots: &[u32]) -> Vec<Tree> {
    let mut kids: HashMap<u32, Vec<&Proc>> = HashMap::new();
    for p in procs.iter().filter(|p| p.pid != p.parent) {
        kids.entry(p.parent).or_default().push(p);
    }
    roots
        .iter()
        .map(|root| {
            let mut seen = HashSet::new();
            let Some(top) = procs.iter().find(|p| p.pid == *root) else {
                return Tree {
                    bytes: 0,
                    busy: false,
                };
            };
            let (mut stack, mut bytes, mut busy) = (vec![top], 0, false);
            while let Some(p) = stack.pop() {
                if !seen.insert(p.pid) {
                    continue;
                }
                bytes += p.bytes;
                busy |= p.pid != top.pid && p.started >= top.started + MINUTE;
                let children = kids.get(&p.pid).into_iter().flatten().copied();
                stack.extend(children.filter(|c| c.started >= p.started));
            }
            Tree { bytes, busy }
        })
        .collect()
}

/// Every process on the system. One that cannot be opened (another user's, elevated) counts as 0 bytes.
#[cfg(windows)]
pub fn snapshot() -> Vec<Proc> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    let mut out = Vec::new();
    // SAFETY: no pointers are passed; the result is checked.
    let Ok(snap) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
        return out;
    };
    let mut e = PROCESSENTRY32W {
        dwSize: u32::try_from(std::mem::size_of::<PROCESSENTRY32W>()).unwrap_or_default(),
        ..Default::default()
    };
    // SAFETY: `snap` is the snapshot made above; `e` is a PROCESSENTRY32W with its own size in dwSize, as required.
    let mut more = unsafe { Process32FirstW(snap, &mut e) }.is_ok();
    while more {
        let (started, bytes) = stats(e.th32ProcessID);
        out.push(Proc {
            pid: e.th32ProcessID,
            parent: e.th32ParentProcessID,
            started,
            bytes,
        });
        // SAFETY: as for Process32FirstW.
        more = unsafe { Process32NextW(snap, &mut e) }.is_ok();
    }
    // SAFETY: `snap` was created above and is not used after this.
    let _ = unsafe { CloseHandle(snap) };
    out
}

#[cfg(not(windows))]
pub fn snapshot() -> Vec<Proc> {
    Vec::new()
}

/// The computer's physical memory in bytes (0 when unknown).
#[cfg(windows)]
pub fn ram() -> u64 {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut m = MEMORYSTATUSEX {
        dwLength: u32::try_from(std::mem::size_of::<MEMORYSTATUSEX>()).unwrap_or_default(),
        ..Default::default()
    };
    // SAFETY: `m` is a MEMORYSTATUSEX with its own size in dwLength, as the call requires, and outlives it.
    unsafe { GlobalMemoryStatusEx(&mut m) }.map_or(0, |()| m.ullTotalPhys)
}

#[cfg(not(windows))]
pub fn ram() -> u64 {
    0
}

/// When a process started (FILETIME ticks) and its private working set; (0, 0) when it cannot be opened.
#[cfg(windows)]
fn stats(pid: u32) -> (u64, u64) {
    use windows::Win32::Foundation::{CloseHandle, FILETIME};
    use windows::Win32::System::ProcessStatus::{
        GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS_EX2,
    };
    use windows::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    // SAFETY: no pointers are passed; the result is checked.
    let Ok(h) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }) else {
        return (0, 0);
    };
    let (mut created, mut exited, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    // SAFETY: `h` was just opened with the access GetProcessTimes needs; the four FILETIMEs outlive the call.
    let started = unsafe { GetProcessTimes(h, &mut created, &mut exited, &mut kernel, &mut user) }
        .map_or(0, |()| {
            (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime)
        });
    let mut m = PROCESS_MEMORY_COUNTERS_EX2::default();
    // SAFETY: `m` is a PROCESS_MEMORY_COUNTERS_EX2 and `cb` says so, which the call accepts in place of the base
    // struct of its signature; `m` outlives the call and `h` is open with PROCESS_QUERY_LIMITED_INFORMATION.
    let read = unsafe {
        GetProcessMemoryInfo(
            h,
            std::ptr::from_mut(&mut m).cast(),
            u32::try_from(std::mem::size_of_val(&m)).unwrap_or_default(),
        )
    };
    // SAFETY: `h` was opened above and is not used after this.
    let _ = unsafe { CloseHandle(h) };
    (
        started,
        if read.is_ok() {
            m.PrivateWorkingSetSize as u64
        } else {
            0
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn p(pid: u32, parent: u32, started: u64, bytes: u64) -> Proc {
        Proc {
            pid,
            parent,
            started,
            bytes,
        }
    }

    fn bytes(t: Vec<Tree>) -> Vec<u64> {
        t.into_iter().map(|t| t.bytes).collect()
    }

    #[test]
    fn sums_a_tree_with_its_grandchildren() {
        let procs = [
            p(1, 0, 1, 10),
            p(2, 1, 2, 20),
            p(3, 2, 3, 30),
            p(4, 9, 4, 40),
        ];
        assert_eq!(bytes(trees(&procs, &[1, 2, 4, 7])), vec![60, 50, 40, 0]);
    }

    #[test]
    fn a_reused_parent_id_does_not_adopt_older_processes() {
        // 5 started before 1: its real parent ended and 1 got the same id later
        let procs = [p(1, 0, 10, 10), p(5, 1, 3, 50)];
        assert_eq!(bytes(trees(&procs, &[1])), vec![10]);
    }

    #[test]
    fn a_loop_of_parent_ids_ends() {
        let procs = [p(1, 2, 0, 1), p(2, 1, 0, 2)];
        assert_eq!(bytes(trees(&procs, &[1])), vec![3]);
    }

    #[test]
    fn busy_only_with_something_started_after_its_first_minute() {
        // 2 = an MCP server started with it; 4 = a command run later (a grandchild counts too)
        let quiet = [p(1, 0, 0, 1), p(2, 1, MINUTE / 2, 1)];
        let working = [
            p(1, 0, 0, 1),
            p(2, 1, MINUTE / 2, 1),
            p(4, 2, 2 * MINUTE, 1),
        ];
        assert!(!trees(&quiet, &[1])[0].busy);
        assert!(trees(&working, &[1])[0].busy);
    }

    #[cfg(windows)]
    #[test]
    fn finds_this_process_and_its_memory() {
        let procs = snapshot();
        let me = std::process::id();
        assert!(procs
            .iter()
            .any(|p| p.pid == me && p.bytes > 0 && p.started > 0));
        assert!(trees(&procs, &[me])[0].bytes > 0);
        assert!(ram() > 0);
    }
}
