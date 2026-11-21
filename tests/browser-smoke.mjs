import assert from 'node:assert/strict'
import {chromium} from 'playwright'

const base = 'http://localhost:5173/'
const binary = process.env.FESTFLOW_CHROMIUM
const browser = await chromium.launch(binary ? {
  executablePath: binary,
  args: ['--single-process', '--no-zygote', '--no-sandbox', '--disable-dev-shm-usage']
} : {})
try {
  async function session(user, path = '') {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}})
    await page.goto(base + path)
    await page.getByLabel('Local demo account').selectOption(user)
    const nav = user.startsWith('customer') ? 'My bookings' : 'Operations'
    await page.getByRole('link', {name: nav, exact: true}).waitFor()
    return page
  }

  const a = await session('customer-a')
  const links = a.getByRole('link', {name: 'Choose seats'})
  await links.first().waitFor()
  assert.equal(await links.count(), 4)
  await a.goto(base + 'shows/last-call')
  const b = await session('customer-b', 'shows/last-call')
  for (const page of [a, b]) {
    await page.getByRole('button', {name: 'A1', exact: true}).click()
    await page.getByLabel('Pepper mushroom puff quantity').selectOption('1')
    await page.getByLabel('Pickup window').selectOption('window-3')
  }
  await Promise.all([a, b].map(page => page.getByRole('button', {name: 'Hold and continue'}).click()))
  const booked = await Promise.race([a, b].map(async page => {
    await page.waitForURL(/\/bookings\/[a-f0-9]+$/, {timeout: 10000})
    return page
  }))
  const other = booked === a ? b : a
  await other.getByText('A seat or pickup window changed.', {exact: false}).waitFor()
  await booked.getByRole('button', {name: 'Simulate decline'}).click()
  await booked.getByText('Simulated payment declined.', {exact: false}).waitFor()
  await booked.getByRole('button', {name: 'Simulate approval'}).click()
  await booked.getByRole('button', {name: 'Load QR ticket'}).click({timeout: 20000})
  const image = booked.getByRole('img', {name: 'Entry QR code'})
  await image.waitFor()
  await booked.waitForFunction(() => document.querySelector('img[alt="Entry QR code"]')?.naturalWidth === 360)
  const id = booked.url().split('/').at(-1)
  const code = await booked.evaluate(async id => {
    const response = await fetch('/api/bookings/' + id + '/ticket', {
      headers: {authorization: 'Bearer ' + sessionStorage.getItem('ff-token')}
    })
    return (await response.json()).code
  }, id)

  const kitchen = await session('kitchen', 'operations')
  await kitchen.getByLabel('Location').selectOption('tiffin')
  for (const step of ['preparing', 'ready', 'collected']) {
    await kitchen.getByRole('button', {name: 'Mark ' + step}).click()
  }
  const venue = await session('venue', 'operations')
  await venue.getByLabel('Location').selectOption('silk')
  await venue.getByLabel('Ticket code').fill(code)
  await venue.getByRole('button', {name: 'Validate ticket'}).click()
  await venue.getByText('Ticket accepted. Guest checked in.').waitFor()
  await venue.getByRole('button', {name: 'Validate ticket'}).click()
  await venue.getByText('This booking has been cancelled or already checked in.').waitFor()
  const admin = await session('admin', 'operations')
  await admin.getByText('TICKET CHECKED IN', {exact: true}).waitFor()

  const mobile = await browser.newPage({viewport: {width: 390, height: 844}})
  await mobile.goto(base)
  await mobile.getByRole('link', {name: 'Choose seats'}).first().waitFor()
  assert.equal(await mobile.evaluate(() => document.body.scrollWidth), 390)
  console.log('Browser smoke passed: race, payment, QR, kitchen, venue, audit and mobile layout.')
} finally {
  await browser.close()
}
