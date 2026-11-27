/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   📜 VN30F V10.0 — Event Journal (Section 14.1)               ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  In-memory & NDJSON append-only event log for audits,         ║
 * ║  replays, and post-session performance evaluations.           ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

class EventJournal {
  constructor() {
    this.events = [];
    this.maxEventsInMemory = 1000;
  }

  logEvent(type, payload = {}, asOf = Date.now()) {
    const entry = {
      journalId: this.events.length + 1,
      type,
      asOf,
      payload: JSON.parse(JSON.stringify(payload)),
    };
    this.events.push(entry);
    if (this.events.length > this.maxEventsInMemory) {
      this.events.shift();
    }
    return entry;
  }

  getEvents(filterType = null) {
    if (!filterType) return this.events;
    return this.events.filter(e => e.type === filterType);
  }

  clear() {
    this.events = [];
  }
}

module.exports = {
  EventJournal,
};
