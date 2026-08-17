/* ==========================================================================
   SERVICES / WORKSHOP — the service list and the booking form
   Photos: type a filename after  photo:  e.g.  photo: "images/hero.jpg"
   (drop the real file into that folder). Leave "" and you can still drag an
   image straight onto the slot in the page — it remembers what you drop.
   ========================================================================== */
window.RICKICE_SERVICES = {

  photo: "",
  title: "The workshop",
  blurb: "Bought it from us or somewhere else — we'll still fit it, fix it or build it.",

  items: [
    { title: "Fitting & install", meta: "Audio, lighting, cameras, accessories", price: "From EC$120" },
    { title: "Repairs & diagnostics", meta: "Head units, wiring, speakers, tech", price: "From EC$80" },
    { title: "Custom builds", meta: "Boxes, panels, full sound builds", price: "Quoted per job" }
  ],

  bookingTitle: "Request a service",
  bookingBlurb: "Tell us the service, the item and what's going wrong. We confirm by WhatsApp.",
  issueLabel: "What's the issue?",
  issuePlaceholder: "Describe the problem or the job — required",
  bookingCta: "Request service",
  serviceOptions: ["Fitting & install", "Repair or diagnostic", "Custom build"],

  /* Charge added when a customer ticks "add fitting" on a product */
  fitting: { label: "Add workshop fitting", price: "120", note: "We call to set a time after checkout." }
};
