'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { resolveCountry, detectCountries, findCountry } = require('../src/lib/geo');
const { parseDate, extractDeadline } = require('../src/lib/dates');
const { compileKeywords, score, compileExclusions, findExclusion } = require('../src/lib/relevance');
const { isJunkTitle } = require('../src/lib/text');

test('detecta países objetivo en español, inglés y portugués', () => {
  assert.equal(detectCountries('Consultoría en Tegucigalpa, Honduras')[0].country.name, 'Honduras');
  assert.equal(detectCountries('Project in the Dominican Republic')[0].country.name, 'República Dominicana');
  assert.equal(detectCountries('Pesquisa de mercado no Brasil')[0].country.name, 'Brasil');
  assert.equal(detectCountries('Survey for USA agencies')[0].country.name, 'Estados Unidos');
  assert.equal(detectCountries('Commonwealth of Dominica agriculture')[0].country.name, 'Dominica');
});

test('no confunde palabras parecidas', () => {
  assert.equal(detectCountries('Dominicana').length, 0, 'Dominicana sola no es República Dominicana ni Dominica');
  assert.equal(detectCountries('the services us team').length, 0, '"us" en minúscula no es EE. UU.');
  assert.equal(detectCountries('Panamericana highway')[0], undefined);
});

test('regional pierde contra país concreto', () => {
  const r = detectCountries('Latin America and the Caribbean study, focus on Guatemala');
  assert.equal(r[0].country.name, 'Guatemala');
  assert.equal(detectCountries('Latin America and the Caribbean study')[0].country.name, 'Regional Latinoamérica');
});

test('resolveCountry descarta países fuera de la región', () => {
  assert.equal(resolveCountry({ explicit: 'Ecuador', title: 'Hiring consultant' }).country, null);
  assert.equal(resolveCountry({ explicit: 'Ecuador', title: 'x' }).reason, 'fuera-de-region');
  assert.equal(resolveCountry({ explicit: 'Saint Lucia' }).country.name, 'Santa Lucía');
  assert.equal(resolveCountry({ explicit: 'Western Hemisphere', title: 'Evaluation in Haiti' }).country.name, 'Haití');
  assert.equal(resolveCountry({ title: 'Estudio', sourceDefault: 'Guatemala' }).country.name, 'Guatemala');
  assert.equal(resolveCountry({ title: 'Estudio' }).reason, 'sin-pais');
  assert.equal(findCountry('Dominican Republic').name, 'República Dominicana');
});

test('interpreta fechas en varios formatos', () => {
  const iso = d => d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.equal(iso(parseDate('2026-11-30')), '2026-11-30');
  assert.equal(iso(parseDate('30/11/2026')), '2026-11-30');
  assert.equal(iso(parseDate('11/30/2026')), '2026-11-30');
  assert.equal(iso(parseDate('03/04/2026', { preferMonthFirst: true })), '2026-03-04');
  assert.equal(iso(parseDate('30 de noviembre de 2026')), '2026-11-30');
  assert.equal(iso(parseDate('30-Nov-2026')), '2026-11-30');
  assert.equal(iso(parseDate('November 30, 2026')), '2026-11-30');
  assert.equal(iso(parseDate('30 de dezembro de 2026')), '2026-12-30');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(iso(parseDate('2026-11-30T00:00:00Z')), '2026-11-30', 'medianoche UTC = solo fecha');
  assert.equal(parseDate('texto sin fecha'), null);
});

test('encuentra la fecha límite en un texto', () => {
  const iso = d => d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.equal(iso(extractDeadline('Publicado: 01/10/2026. Fecha límite de recepción: 15 de diciembre de 2026 a las 17:00')), '2026-12-15');
  assert.equal(iso(extractDeadline('Closing date: December 3, 2026')), '2026-12-03');
  assert.equal(extractDeadline('Sin fecha aquí'), null);
});

test('relevancia: sin acentos, siglas exactas y título vale doble', () => {
  const kws = compileKeywords([
    { Keyword: 'Consultoría', GroupName: 'Principal', Points: 35 },
    { Keyword: 'TOR', GroupName: 'Principal', Points: 35 },
    { Keyword: 'Encuesta', GroupName: 'Relacionada', Points: 25 }
  ]);
  const a = score({ title: 'CONSULTORIA para encuesta nacional', description: '' }, kws);
  assert.equal(a.score, 120);
  assert.equal(a.level, 'Crítica');
  const b = score({ title: 'Apoyo al sector salud', description: 'director del sector' }, kws);
  assert.equal(b.score, 0, '"tor" no debe coincidir dentro de "sector" ni "director"');
  const c = score({ title: 'Servicios', description: 'Ver TOR adjuntos' }, kws);
  assert.equal(c.score, 35);
});

test('exclusiones y títulos basura', () => {
  const ex = compileExclusions([{ Keyword: 'vacante' }]);
  assert.equal(findExclusion('Vacante: oficial de programa', ex), 'vacante');
  assert.equal(findExclusion('Consultoría de evaluación', ex), null);
  assert.ok(isJunkTitle('Leer más'));
  assert.ok(isJunkTitle('Read more »'));
  assert.ok(!isJunkTitle('Consultoría para línea base del programa'));
});

test('no se cuenta dos veces la misma raíz', () => {
  const kws = compileKeywords([
    { Keyword: 'consult', GroupName: 'Principal', Points: 10 },
    { Keyword: 'Consultor', GroupName: 'Principal', Points: 30 },
    { Keyword: 'Consultoría', GroupName: 'Principal', Points: 35 }
  ]);
  const r = score({ title: 'Consultoría de género', description: '' }, kws);
  assert.equal(r.matches.length, 1);
  assert.equal(r.score, 70);
});

test('lo que solo está en la descripción tiene tope', () => {
  const kws = compileKeywords([
    { Keyword: 'Evaluación', GroupName: 'Relacionada', Points: 25 },
    { Keyword: 'Monitoreo', GroupName: 'Relacionada', Points: 25 },
    { Keyword: 'Datos', GroupName: 'General', Points: 10 }
  ]);
  const r = score({ title: 'Oficial de operaciones', description: 'evaluación, monitoreo y datos' }, kws);
  assert.equal(r.score, 45);
  assert.equal(r.level, 'Media');
});

test('descarta avisos que nombran un país fuera de la cobertura', () => {
  const r = resolveCountry({ title: 'New Consultancy - Health Nutrition, 4 months, remote, Ulaanbaatar, Mongolia', sourceDefault: 'Guatemala' });
  assert.equal(r.country, null);
  assert.equal(r.reason, 'fuera-de-region');
  assert.equal(resolveCountry({ title: 'Consultancy in Guatemala and Colombia' }).country.name, 'Guatemala');
  assert.equal(resolveCountry({ title: 'Evaluación del programa', description: 'Cooperación con España', sourceDefault: 'Honduras' }).country.name, 'Honduras');
  assert.equal(resolveCountry({ title: 'Evaluación', description: 'Proyecto en Kenya' }).reason, 'fuera-de-region');
});
