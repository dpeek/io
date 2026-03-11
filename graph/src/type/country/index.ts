import { defineEnum } from "../../graph/schema.js";
import { defineDefaultEnumTypeModule } from "../enum-module.js";

export const country = defineEnum({
  values: { key: "core:country", name: "Country" },
  options: {
    af: {
      name: "Afghanistan",
      code: "AF",
    },
    ax: {
      name: "Aland Islands",
      code: "AX",
    },
    al: {
      name: "Albania",
      code: "AL",
    },
    dz: {
      name: "Algeria",
      code: "DZ",
    },
    as: {
      name: "American Samoa",
      code: "AS",
    },
    ad: {
      name: "Andorra",
      code: "AD",
    },
    ao: {
      name: "Angola",
      code: "AO",
    },
    ai: {
      name: "Anguilla",
      code: "AI",
    },
    aq: {
      name: "Antarctica",
      code: "AQ",
    },
    ag: {
      name: "Antigua And Barbuda",
      code: "AG",
    },
    ar: {
      name: "Argentina",
      code: "AR",
    },
    am: {
      name: "Armenia",
      code: "AM",
    },
    aw: {
      name: "Aruba",
      code: "AW",
    },
    au: {
      name: "Australia",
      code: "AU",
    },
    at: {
      name: "Austria",
      code: "AT",
    },
    az: {
      name: "Azerbaijan",
      code: "AZ",
    },
    bs: {
      name: "Bahamas",
      code: "BS",
    },
    bh: {
      name: "Bahrain",
      code: "BH",
    },
    bd: {
      name: "Bangladesh",
      code: "BD",
    },
    bb: {
      name: "Barbados",
      code: "BB",
    },
    by: {
      name: "Belarus",
      code: "BY",
    },
    be: {
      name: "Belgium",
      code: "BE",
    },
    bz: {
      name: "Belize",
      code: "BZ",
    },
    bj: {
      name: "Benin",
      code: "BJ",
    },
    bm: {
      name: "Bermuda",
      code: "BM",
    },
    bt: {
      name: "Bhutan",
      code: "BT",
    },
    bo: {
      name: "Bolivia",
      code: "BO",
    },
    ba: {
      name: "Bosnia And Herzegovina",
      code: "BA",
    },
    bw: {
      name: "Botswana",
      code: "BW",
    },
    bv: {
      name: "Bouvet Island",
      code: "BV",
    },
    br: {
      name: "Brazil",
      code: "BR",
    },
    io: {
      name: "British Indian Ocean Territory",
      code: "IO",
    },
    bn: {
      name: "Brunei Darussalam",
      code: "BN",
    },
    bg: {
      name: "Bulgaria",
      code: "BG",
    },
    bf: {
      name: "Burkina Faso",
      code: "BF",
    },
    bi: {
      name: "Burundi",
      code: "BI",
    },
    kh: {
      name: "Cambodia",
      code: "KH",
    },
    cm: {
      name: "Cameroon",
      code: "CM",
    },
    ca: {
      name: "Canada",
      code: "CA",
    },
    cv: {
      name: "Cape Verde",
      code: "CV",
    },
    ky: {
      name: "Cayman Islands",
      code: "KY",
    },
    cf: {
      name: "Central African Republic",
      code: "CF",
    },
    td: {
      name: "Chad",
      code: "TD",
    },
    cl: {
      name: "Chile",
      code: "CL",
    },
    cn: {
      name: "China",
      code: "CN",
    },
    cx: {
      name: "Christmas Island",
      code: "CX",
    },
    cc: {
      name: "Cocos (Keeling) Islands",
      code: "CC",
    },
    co: {
      name: "Colombia",
      code: "CO",
    },
    km: {
      name: "Comoros",
      code: "KM",
    },
    cg: {
      name: "Congo",
      code: "CG",
    },
    cd: {
      name: "Congo, Democratic Republic",
      code: "CD",
    },
    ck: {
      name: "Cook Islands",
      code: "CK",
    },
    cr: {
      name: "Costa Rica",
      code: "CR",
    },
    ci: {
      name: 'Cote D"Ivoire',
      code: "CI",
    },
    hr: {
      name: "Croatia",
      code: "HR",
    },
    cu: {
      name: "Cuba",
      code: "CU",
    },
    cy: {
      name: "Cyprus",
      code: "CY",
    },
    cz: {
      name: "Czech Republic",
      code: "CZ",
    },
    dk: {
      name: "Denmark",
      code: "DK",
    },
    dj: {
      name: "Djibouti",
      code: "DJ",
    },
    dm: {
      name: "Dominica",
      code: "DM",
    },
    do: {
      name: "Dominican Republic",
      code: "DO",
    },
    ec: {
      name: "Ecuador",
      code: "EC",
    },
    eg: {
      name: "Egypt",
      code: "EG",
    },
    sv: {
      name: "El Salvador",
      code: "SV",
    },
    gq: {
      name: "Equatorial Guinea",
      code: "GQ",
    },
    er: {
      name: "Eritrea",
      code: "ER",
    },
    ee: {
      name: "Estonia",
      code: "EE",
    },
    et: {
      name: "Ethiopia",
      code: "ET",
    },
    fk: {
      name: "Falkland Islands (Malvinas)",
      code: "FK",
    },
    fo: {
      name: "Faroe Islands",
      code: "FO",
    },
    fj: {
      name: "Fiji",
      code: "FJ",
    },
    fi: {
      name: "Finland",
      code: "FI",
    },
    fr: {
      name: "France",
      code: "FR",
    },
    gf: {
      name: "French Guiana",
      code: "GF",
    },
    pf: {
      name: "French Polynesia",
      code: "PF",
    },
    tf: {
      name: "French Southern Territories",
      code: "TF",
    },
    ga: {
      name: "Gabon",
      code: "GA",
    },
    gm: {
      name: "Gambia",
      code: "GM",
    },
    ge: {
      name: "Georgia",
      code: "GE",
    },
    de: {
      name: "Germany",
      code: "DE",
    },
    gh: {
      name: "Ghana",
      code: "GH",
    },
    gi: {
      name: "Gibraltar",
      code: "GI",
    },
    gr: {
      name: "Greece",
      code: "GR",
    },
    gl: {
      name: "Greenland",
      code: "GL",
    },
    gd: {
      name: "Grenada",
      code: "GD",
    },
    gp: {
      name: "Guadeloupe",
      code: "GP",
    },
    gu: {
      name: "Guam",
      code: "GU",
    },
    gt: {
      name: "Guatemala",
      code: "GT",
    },
    gg: {
      name: "Guernsey",
      code: "GG",
    },
    gn: {
      name: "Guinea",
      code: "GN",
    },
    gw: {
      name: "Guinea-Bissau",
      code: "GW",
    },
    gy: {
      name: "Guyana",
      code: "GY",
    },
    ht: {
      name: "Haiti",
      code: "HT",
    },
    hm: {
      name: "Heard Island & Mcdonald Islands",
      code: "HM",
    },
    va: {
      name: "Holy See (Vatican City State)",
      code: "VA",
    },
    hn: {
      name: "Honduras",
      code: "HN",
    },
    hk: {
      name: "Hong Kong",
      code: "HK",
    },
    hu: {
      name: "Hungary",
      code: "HU",
    },
    is: {
      name: "Iceland",
      code: "IS",
    },
    in: {
      name: "India",
      code: "IN",
    },
    id: {
      name: "Indonesia",
      code: "ID",
    },
    ir: {
      name: "Iran, Islamic Republic Of",
      code: "IR",
    },
    iq: {
      name: "Iraq",
      code: "IQ",
    },
    ie: {
      name: "Ireland",
      code: "IE",
    },
    im: {
      name: "Isle Of Man",
      code: "IM",
    },
    il: {
      name: "Israel",
      code: "IL",
    },
    it: {
      name: "Italy",
      code: "IT",
    },
    jm: {
      name: "Jamaica",
      code: "JM",
    },
    jp: {
      name: "Japan",
      code: "JP",
    },
    je: {
      name: "Jersey",
      code: "JE",
    },
    jo: {
      name: "Jordan",
      code: "JO",
    },
    kz: {
      name: "Kazakhstan",
      code: "KZ",
    },
    ke: {
      name: "Kenya",
      code: "KE",
    },
    ki: {
      name: "Kiribati",
      code: "KI",
    },
    kr: {
      name: "Korea",
      code: "KR",
    },
    kp: {
      name: "North Korea",
      code: "KP",
    },
    kw: {
      name: "Kuwait",
      code: "KW",
    },
    kg: {
      name: "Kyrgyzstan",
      code: "KG",
    },
    la: {
      name: 'Lao People"s Democratic Republic',
      code: "LA",
    },
    lv: {
      name: "Latvia",
      code: "LV",
    },
    lb: {
      name: "Lebanon",
      code: "LB",
    },
    ls: {
      name: "Lesotho",
      code: "LS",
    },
    lr: {
      name: "Liberia",
      code: "LR",
    },
    ly: {
      name: "Libyan Arab Jamahiriya",
      code: "LY",
    },
    li: {
      name: "Liechtenstein",
      code: "LI",
    },
    lt: {
      name: "Lithuania",
      code: "LT",
    },
    lu: {
      name: "Luxembourg",
      code: "LU",
    },
    mo: {
      name: "Macao",
      code: "MO",
    },
    mk: {
      name: "Macedonia",
      code: "MK",
    },
    mg: {
      name: "Madagascar",
      code: "MG",
    },
    mw: {
      name: "Malawi",
      code: "MW",
    },
    my: {
      name: "Malaysia",
      code: "MY",
    },
    mv: {
      name: "Maldives",
      code: "MV",
    },
    ml: {
      name: "Mali",
      code: "ML",
    },
    mt: {
      name: "Malta",
      code: "MT",
    },
    mh: {
      name: "Marshall Islands",
      code: "MH",
    },
    mq: {
      name: "Martinique",
      code: "MQ",
    },
    mr: {
      name: "Mauritania",
      code: "MR",
    },
    mu: {
      name: "Mauritius",
      code: "MU",
    },
    yt: {
      name: "Mayotte",
      code: "YT",
    },
    mx: {
      name: "Mexico",
      code: "MX",
    },
    fm: {
      name: "Micronesia, Federated States Of",
      code: "FM",
    },
    md: {
      name: "Moldova",
      code: "MD",
    },
    mc: {
      name: "Monaco",
      code: "MC",
    },
    mn: {
      name: "Mongolia",
      code: "MN",
    },
    me: {
      name: "Montenegro",
      code: "ME",
    },
    ms: {
      name: "Montserrat",
      code: "MS",
    },
    ma: {
      name: "Morocco",
      code: "MA",
    },
    mz: {
      name: "Mozambique",
      code: "MZ",
    },
    mm: {
      name: "Myanmar",
      code: "MM",
    },
    na: {
      name: "Namibia",
      code: "NA",
    },
    nr: {
      name: "Nauru",
      code: "NR",
    },
    np: {
      name: "Nepal",
      code: "NP",
    },
    nl: {
      name: "Netherlands",
      code: "NL",
    },
    an: {
      name: "Netherlands Antilles",
      code: "AN",
    },
    nc: {
      name: "New Caledonia",
      code: "NC",
    },
    nz: {
      name: "New Zealand",
      code: "NZ",
    },
    ni: {
      name: "Nicaragua",
      code: "NI",
    },
    ne: {
      name: "Niger",
      code: "NE",
    },
    ng: {
      name: "Nigeria",
      code: "NG",
    },
    nu: {
      name: "Niue",
      code: "NU",
    },
    nf: {
      name: "Norfolk Island",
      code: "NF",
    },
    mp: {
      name: "Northern Mariana Islands",
      code: "MP",
    },
    no: {
      name: "Norway",
      code: "NO",
    },
    om: {
      name: "Oman",
      code: "OM",
    },
    pk: {
      name: "Pakistan",
      code: "PK",
    },
    pw: {
      name: "Palau",
      code: "PW",
    },
    ps: {
      name: "Palestinian Territory, Occupied",
      code: "PS",
    },
    pa: {
      name: "Panama",
      code: "PA",
    },
    pg: {
      name: "Papua New Guinea",
      code: "PG",
    },
    py: {
      name: "Paraguay",
      code: "PY",
    },
    pe: {
      name: "Peru",
      code: "PE",
    },
    ph: {
      name: "Philippines",
      code: "PH",
    },
    pn: {
      name: "Pitcairn",
      code: "PN",
    },
    pl: {
      name: "Poland",
      code: "PL",
    },
    pt: {
      name: "Portugal",
      code: "PT",
    },
    pr: {
      name: "Puerto Rico",
      code: "PR",
    },
    qa: {
      name: "Qatar",
      code: "QA",
    },
    re: {
      name: "Reunion",
      code: "RE",
    },
    ro: {
      name: "Romania",
      code: "RO",
    },
    ru: {
      name: "Russian Federation",
      code: "RU",
    },
    rw: {
      name: "Rwanda",
      code: "RW",
    },
    bl: {
      name: "Saint Barthelemy",
      code: "BL",
    },
    sh: {
      name: "Saint Helena",
      code: "SH",
    },
    kn: {
      name: "Saint Kitts And Nevis",
      code: "KN",
    },
    lc: {
      name: "Saint Lucia",
      code: "LC",
    },
    mf: {
      name: "Saint Martin",
      code: "MF",
    },
    pm: {
      name: "Saint Pierre And Miquelon",
      code: "PM",
    },
    vc: {
      name: "Saint Vincent And Grenadines",
      code: "VC",
    },
    ws: {
      name: "Samoa",
      code: "WS",
    },
    sm: {
      name: "San Marino",
      code: "SM",
    },
    st: {
      name: "Sao Tome And Principe",
      code: "ST",
    },
    sa: {
      name: "Saudi Arabia",
      code: "SA",
    },
    sn: {
      name: "Senegal",
      code: "SN",
    },
    rs: {
      name: "Serbia",
      code: "RS",
    },
    sc: {
      name: "Seychelles",
      code: "SC",
    },
    sl: {
      name: "Sierra Leone",
      code: "SL",
    },
    sg: {
      name: "Singapore",
      code: "SG",
    },
    sk: {
      name: "Slovakia",
      code: "SK",
    },
    si: {
      name: "Slovenia",
      code: "SI",
    },
    sb: {
      name: "Solomon Islands",
      code: "SB",
    },
    so: {
      name: "Somalia",
      code: "SO",
    },
    za: {
      name: "South Africa",
      code: "ZA",
    },
    gs: {
      name: "South Georgia And Sandwich Isl.",
      code: "GS",
    },
    es: {
      name: "Spain",
      code: "ES",
    },
    lk: {
      name: "Sri Lanka",
      code: "LK",
    },
    sd: {
      name: "Sudan",
      code: "SD",
    },
    sr: {
      name: "Suriname",
      code: "SR",
    },
    sj: {
      name: "Svalbard And Jan Mayen",
      code: "SJ",
    },
    sz: {
      name: "Swaziland",
      code: "SZ",
    },
    se: {
      name: "Sweden",
      code: "SE",
    },
    ch: {
      name: "Switzerland",
      code: "CH",
    },
    sy: {
      name: "Syrian Arab Republic",
      code: "SY",
    },
    tw: {
      name: "Taiwan",
      code: "TW",
    },
    tj: {
      name: "Tajikistan",
      code: "TJ",
    },
    tz: {
      name: "Tanzania",
      code: "TZ",
    },
    th: {
      name: "Thailand",
      code: "TH",
    },
    tl: {
      name: "Timor-Leste",
      code: "TL",
    },
    tg: {
      name: "Togo",
      code: "TG",
    },
    tk: {
      name: "Tokelau",
      code: "TK",
    },
    to: {
      name: "Tonga",
      code: "TO",
    },
    tt: {
      name: "Trinidad And Tobago",
      code: "TT",
    },
    tn: {
      name: "Tunisia",
      code: "TN",
    },
    tr: {
      name: "Turkey",
      code: "TR",
    },
    tm: {
      name: "Turkmenistan",
      code: "TM",
    },
    tc: {
      name: "Turks And Caicos Islands",
      code: "TC",
    },
    tv: {
      name: "Tuvalu",
      code: "TV",
    },
    ug: {
      name: "Uganda",
      code: "UG",
    },
    ua: {
      name: "Ukraine",
      code: "UA",
    },
    ae: {
      name: "United Arab Emirates",
      code: "AE",
    },
    gb: {
      name: "United Kingdom",
      code: "GB",
    },
    us: {
      name: "United States",
      code: "US",
    },
    um: {
      name: "United States Outlying Islands",
      code: "UM",
    },
    uy: {
      name: "Uruguay",
      code: "UY",
    },
    uz: {
      name: "Uzbekistan",
      code: "UZ",
    },
    vu: {
      name: "Vanuatu",
      code: "VU",
    },
    ve: {
      name: "Venezuela",
      code: "VE",
    },
    vn: {
      name: "Vietnam",
      code: "VN",
    },
    vg: {
      name: "Virgin Islands, British",
      code: "VG",
    },
    vi: {
      name: "Virgin Islands, U.S.",
      code: "VI",
    },
    wf: {
      name: "Wallis And Futuna",
      code: "WF",
    },
    eh: {
      name: "Western Sahara",
      code: "EH",
    },
    ye: {
      name: "Yemen",
      code: "YE",
    },
    zm: {
      name: "Zambia",
      code: "ZM",
    },
    zw: {
      name: "Zimbabwe",
      code: "ZW",
    },
  },
});

export const countryTypeModule = defineDefaultEnumTypeModule(country);
