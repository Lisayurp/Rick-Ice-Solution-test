/* ==========================================================================
   BOUTIQUE — edit everything about the boutique department here.
   Photos: paste a URL after  photo:  OR leave "" and drag an image onto the
   slot in the page. Every slot remembers what you drop on it.
   ========================================================================== */
window.RICKICE_BOUTIQUE = {

  label: "Boutique",
  eyebrow: "The Boutique",
  title: "Style that lands on the island first.",
  blurb: "Clothing, accessories and gifts, stocked locally and refreshed every week.",
  heroPhoto: "",

  /* Round category badges — the row across the top of the boutique page */
  categories: [
    { name: "Tops",        photo: "" },
    { name: "Bottoms",     photo: "" },
    { name: "Dresses",     photo: "" },
    { name: "Shoes",       photo: "" },
    { name: "Accessories", photo: "" },
    { name: "Men",         photo: "" },
    { name: "Sale",        photo: "", sale: true }
  ],

  /* Promo tiles — three wide cards under new arrivals */
  promos: [
    { kicker: "New in", title: "This week's rail", note: "Fresh stock, straight to the floor.", cta: "Shop new in", photo: "" },
    { kicker: "New season",   title: "New look", note: "This week's arrivals, together.", cta: "Shop now", photo: "" },
    { kicker: "Visit us",     title: "In store", note: "Find us and our opening hours.", cta: "Find the shop", photo: "" }
  ],

  /* Collections band */
  collectionsTitle: "Explore collections",
  collectionsBlurb: "Handpicked looks for every occasion.",
  collections: [
    { name: "The everyday edit", note: "Easy pieces you reach for daily.", photo: "" },
    { name: "Weekend vibes",     note: "Relaxed fits for days off.",       photo: "" },
    { name: "Date night",        note: "Sharper cuts, darker tones.",      photo: "" },
    { name: "Island occasion",   note: "Weddings, church and events.",     photo: "" }
  ],

  /* Products. price/was in plain numbers — the EC$ is added for you.
     colours are shown as small swatches on the card.                        */
  products: [
    { slotId: "b01", name: "Linen summer shirt",   price: "129", was: "165", badge: "Sale", category: "Tops",        colours: ["#F5F2E9", "#003B46", "#A67C52"], blurb: "Breathable linen, cut for the heat. Sizes S–XXL.", photo: "" },
    { slotId: "b02", name: "Wide-leg trousers",    price: "175", was: "",    badge: "New",  category: "Bottoms",     colours: ["#003B46", "#7A7264"],            blurb: "High waist, fluid drop, side pockets.", photo: "" },
    { slotId: "b03", name: "Linen blend dress",    price: "215", was: "",    badge: "",     category: "Dresses",     colours: ["#F5F2E9", "#66A5AD"],            blurb: "Midi length with a tie waist.", photo: "" },
    { slotId: "b04", name: "Woven leather sandals",price: "149", was: "",    badge: "New",  category: "Shoes",       colours: ["#A67C52", "#3B2F2A"],            blurb: "Hand-woven uppers on a cushioned sole.", photo: "" },
    { slotId: "b05", name: "Straw sun hat",        price: "72",  was: "",    badge: "",     category: "Accessories", colours: ["#E5D6B8"],                       blurb: "Wide brim, packable, adjustable band.", photo: "" },
    { slotId: "b06", name: "Oversized knit",       price: "195", was: "240", badge: "Sale", category: "Men",         colours: ["#003B46", "#F5F2E9"],            blurb: "Loose gauge cotton knit for cool evenings.", photo: "" },
    { slotId: "b07", name: "Cotton two-piece set", price: "185", was: "",    badge: "New",  category: "Tops",        colours: ["#EAD9C4", "#66A5AD"],            blurb: "Matching set in soft washed cotton.", photo: "" },
    { slotId: "b08", name: "Shoulder bag",         price: "168", was: "",    badge: "",     category: "Accessories", colours: ["#A67C52", "#3B2F2A"],            blurb: "Structured leather with a slim strap.", photo: "" }
  ]
};
