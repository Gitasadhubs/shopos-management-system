import { startDayEndScheduler } from './lib/day-end'

// Self-hosted installs check every minute for day-end reports that are due (lib/day-end.ts).
// SHOPOS_DAY_END_SCHEDULER=off turns that off, e.g. on extra app instances.
if (process.env.SHOPOS_STORAGE === 'mariadb' && process.env.SHOPOS_DAY_END_SCHEDULER !== 'off') {
  startDayEndScheduler()
}
