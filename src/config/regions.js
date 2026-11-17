'use strict';

/**
 * Cobertura geográfica del sistema.
 * Solo se guardan oportunidades cuyo país (o región) esté en esta lista.
 * Para ampliar o reducir la cobertura basta con editar este archivo.
 */

const REGIONS = {
  CA: { name: 'Centroamérica', short: 'Centroamérica' },
  CARIBE: { name: 'Caribe', short: 'Caribe' },
  MX: { name: 'México', short: 'México' },
  US: { name: 'Estados Unidos', short: 'EE. UU.' },
  BR: { name: 'Brasil', short: 'Brasil' },
  REG: { name: 'Regional / multipaís', short: 'Regional' }
};

// name: nombre canónico en español (es el que se guarda en la tabla Countries)
// aliases: cómo puede aparecer en textos en español, inglés, portugués o francés
const COUNTRIES = [
  // Centroamérica
  { name: 'Guatemala', iso: 'GT', region: 'CA', aliases: ['guatemala'] },
  { name: 'Belice', iso: 'BZ', region: 'CA', aliases: ['belice', 'belize'] },
  { name: 'Honduras', iso: 'HN', region: 'CA', aliases: ['honduras'] },
  { name: 'El Salvador', iso: 'SV', region: 'CA', aliases: ['el salvador'] },
  { name: 'Nicaragua', iso: 'NI', region: 'CA', aliases: ['nicaragua'] },
  { name: 'Costa Rica', iso: 'CR', region: 'CA', aliases: ['costa rica'] },
  { name: 'Panamá', iso: 'PA', region: 'CA', aliases: ['panama', 'panamá'] },

  // Caribe (incluye miembros de CARICOM continentales: Guyana y Surinam)
  { name: 'República Dominicana', iso: 'DO', region: 'CARIBE', aliases: ['republica dominicana', 'dominican republic', 'rep. dominicana', 'rep dominicana', 'republique dominicaine'] },
  { name: 'Cuba', iso: 'CU', region: 'CARIBE', aliases: ['cuba'] },
  { name: 'Haití', iso: 'HT', region: 'CARIBE', aliases: ['haiti', 'haïti', 'haití'] },
  { name: 'Jamaica', iso: 'JM', region: 'CARIBE', aliases: ['jamaica', 'jamaique'] },
  { name: 'Puerto Rico', iso: 'PR', region: 'CARIBE', aliases: ['puerto rico'] },
  { name: 'Trinidad y Tobago', iso: 'TT', region: 'CARIBE', aliases: ['trinidad y tobago', 'trinidad and tobago', 'trinidad & tobago'] },
  { name: 'Bahamas', iso: 'BS', region: 'CARIBE', aliases: ['bahamas'] },
  { name: 'Barbados', iso: 'BB', region: 'CARIBE', aliases: ['barbados'] },
  { name: 'Santa Lucía', iso: 'LC', region: 'CARIBE', aliases: ['santa lucia', 'saint lucia', 'st. lucia', 'st lucia', 'sainte-lucie'] },
  { name: 'San Vicente y las Granadinas', iso: 'VC', region: 'CARIBE', aliases: ['san vicente y las granadinas', 'saint vincent and the grenadines', 'st. vincent and the grenadines', 'st vincent', 'saint vincent'] },
  { name: 'Granada', iso: 'GD', region: 'CARIBE', aliases: ['grenada'] },
  { name: 'Antigua y Barbuda', iso: 'AG', region: 'CARIBE', aliases: ['antigua y barbuda', 'antigua and barbuda'] },
  { name: 'Dominica', iso: 'DM', region: 'CARIBE', aliases: ['commonwealth of dominica', 'dominica'] },
  { name: 'San Cristóbal y Nieves', iso: 'KN', region: 'CARIBE', aliases: ['san cristobal y nieves', 'saint kitts and nevis', 'st. kitts and nevis', 'st kitts'] },
  { name: 'Guyana', iso: 'GY', region: 'CARIBE', aliases: ['guyana'] },
  { name: 'Surinam', iso: 'SR', region: 'CARIBE', aliases: ['surinam', 'suriname'] },
  { name: 'Aruba', iso: 'AW', region: 'CARIBE', aliases: ['aruba'] },
  { name: 'Curazao', iso: 'CW', region: 'CARIBE', aliases: ['curazao', 'curacao', 'curaçao'] },
  { name: 'Islas Caimán', iso: 'KY', region: 'CARIBE', aliases: ['islas caiman', 'cayman islands'] },
  { name: 'Islas Turcas y Caicos', iso: 'TC', region: 'CARIBE', aliases: ['turks and caicos', 'islas turcas y caicos'] },
  { name: 'Islas Vírgenes', iso: 'VG', region: 'CARIBE', aliases: ['islas virgenes', 'virgin islands'] },
  { name: 'Anguila', iso: 'AI', region: 'CARIBE', aliases: ['anguila', 'anguilla'] },
  { name: 'Montserrat', iso: 'MS', region: 'CARIBE', aliases: ['montserrat'] },

  // México, Estados Unidos y Brasil
  { name: 'México', iso: 'MX', region: 'MX', aliases: ['mexico', 'méxico', 'mexique', 'estados unidos mexicanos'] },
  { name: 'Estados Unidos', iso: 'US', region: 'US', aliases: ['estados unidos', 'united states', 'united states of america', 'eeuu', 'ee.uu.', 'ee. uu.', 'new mexico'], caseSensitive: ['USA', 'U.S.', 'U.S.A.'] },
  { name: 'Brasil', iso: 'BR', region: 'BR', aliases: ['brasil', 'brazil', 'bresil', 'brésil'] },

  // Agrupaciones regionales que incluyen a los países objetivo
  { name: 'Regional Centroamérica', iso: null, region: 'REG', aliases: ['centroamerica', 'central america', 'america central', 'sica', 'triangulo norte', 'northern triangle'] },
  { name: 'Regional Caribe', iso: null, region: 'REG', aliases: ['caribe', 'caribbean', 'caricom', 'oecs', 'eastern caribbean', 'caraibes'] },
  { name: 'Regional Latinoamérica', iso: null, region: 'REG', aliases: ['latin america and the caribbean', 'america latina y el caribe', 'latinoamerica y el caribe', 'lac region', 'mesoamerica', 'mesoamérica'] }
];

// Nombres que se ven en las fuentes viejas o en APIs y que deben mapearse a un país canónico.
const LEGACY_NAMES = {
  'dominican republic': 'República Dominicana',
  'st. lucia': 'Santa Lucía',
  'mexico': 'México',
  'panama': 'Panamá',
  'haiti': 'Haití',
  'belize': 'Belice',
  'brazil': 'Brasil',
  'united states': 'Estados Unidos',
  'regional': null,
  'internacional': null
};

// Países FUERA de la cobertura. Sirven para descartar con seguridad un aviso que dice
// "Ulaanbaatar, Mongolia" aunque venga de una fuente configurada como Guatemala.
// (Se omiten nombres ambiguos como Georgia, Jordan, Chad o Turkey.)
const OTHER_COUNTRIES = [
  'colombia', 'peru', 'perú', 'ecuador', 'venezuela', 'bolivia', 'chile', 'argentina', 'uruguay', 'paraguay',
  'canada', 'canadá', 'spain', 'españa', 'portugal', 'france', 'francia', 'germany', 'alemania', 'italy', 'italia',
  'united kingdom', 'reino unido', 'switzerland', 'suiza', 'netherlands', 'países bajos', 'belgium', 'bélgica',
  'denmark', 'sweden', 'norway', 'finland', 'poland', 'ukraine', 'ucrania', 'moldova', 'romania', 'bulgaria',
  'serbia', 'kosovo', 'albania', 'north macedonia', 'bosnia', 'montenegro', 'armenia', 'azerbaijan', 'türkiye', 'turquía',
  'kazakhstan', 'kyrgyz', 'uzbekistan', 'tajikistan', 'turkmenistan', 'mongolia', 'china', 'india', 'pakistan',
  'afghanistan', 'afganistán', 'bangladesh', 'nepal', 'bhutan', 'sri lanka', 'maldives', 'myanmar', 'thailand', 'tailandia',
  'cambodia', 'camboya', 'lao', 'laos', 'vietnam', 'viet nam', 'malaysia', 'indonesia', 'philippines', 'filipinas',
  'timor-leste', 'papua new guinea', 'fiji', 'samoa', 'tonga', 'vanuatu', 'solomon islands', 'kiribati', 'tuvalu',
  'marshall islands', 'micronesia', 'palau', 'nauru', 'australia', 'new zealand', 'japan', 'japón', 'korea', 'corea',
  'iran', 'irán', 'iraq', 'irak', 'syria', 'siria', 'lebanon', 'líbano', 'palestine', 'palestina', 'gaza', 'israel',
  'yemen', 'saudi arabia', 'oman', 'qatar', 'kuwait', 'bahrain', 'egypt', 'egipto', 'libya', 'libia', 'tunisia', 'túnez',
  'algeria', 'argelia', 'morocco', 'marruecos', 'sudan', 'sudán', 'south sudan', 'ethiopia', 'etiopía', 'eritrea',
  'somalia', 'djibouti', 'kenya', 'kenia', 'uganda', 'tanzania', 'rwanda', 'ruanda', 'burundi', 'congo', 'drc',
  'angola', 'zambia', 'zimbabwe', 'malawi', 'mozambique', 'mozambique', 'madagascar', 'mauritius', 'comoros',
  'south africa', 'sudáfrica', 'namibia', 'botswana', 'lesotho', 'eswatini', 'nigeria', 'ghana', 'senegal', 'mali',
  'burkina faso', 'niger', 'cameroon', 'camerún', 'gabon', 'benin', 'togo', "cote d'ivoire", 'côte d’ivoire', 'ivory coast',
  'liberia', 'sierra leone', 'guinea-bissau', 'equatorial guinea', 'mauritania', 'cabo verde', 'cape verde', 'gambia',
  'central african republic', 'sao tome', 'seychelles', 'africa', 'áfrica', 'asia', 'europe', 'europa', 'pacific islands'
];

module.exports = { REGIONS, COUNTRIES, LEGACY_NAMES, OTHER_COUNTRIES };
