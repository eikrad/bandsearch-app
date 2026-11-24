import assert from "node:assert/strict";
import test from "node:test";
import { compareArtists, findArtist, foldArtistName, isSameArtist, mayBeSameArtist, realMusicBrainzId } from "../src/artistIdentity.js";

const MBID_A = "8b8a38a9-a290-4560-84f6-3d4466e8d791";
const MBID_B = "5b11f4ce-a62d-471e-81fc-a69a8278c7da";

const named = (name: string) => ({ name });

test("spellings that differ only in case, spacing, punctuation or accent marks name the same artist", () => {
  for (const [a, b] of [
    ["Alcest", "alcest"],
    ["  Alcest ", "Alcest"],
    ["Alcést", "Alcest"],
    ["Mogwai!", "mogwai"],
    ["Sigur Rós", "Sigur Ros"],
    ["Ólafur Arnalds", "Olafur Arnalds"],
    ["Hôtel Costes", "Hotel Costes"],
  ]) {
    assert.equal(compareArtists(named(a!), named(b!)), "same", `${a} = ${b}`);
  }
});

test("a leading or trailing definite article does not change the artist, in each listed language", () => {
  for (const [a, b] of [
    ["The Cure", "Cure"],
    ["Cure, The", "The Cure"],
    ["Die Ärzte", "Ärzte"],
    ["Ärzte, Die", "Die Ärzte"],
    ["Die Toten Hosen", "Toten Hosen"],
    ["Der Plan", "Plan"],
    ["Das Ich", "Ich"],
    ["Den Sorte Skole", "Sorte Skole"],
    ["Det Gode Selskab", "Gode Selskab"],
    ["De Dijk", "Dijk"],
    ["Het Goede Doel", "Goede Doel"],
    ["'t Hof van Commerce", "Hof van Commerce"],
    ["L'Impératrice", "Impératrice"],
    ["Les Savy Fav", "Savy Fav"],
    ["La Dispute", "Dispute"],
    ["Le Butcherettes", "Butcherettes"],
    ["El Columpio Asesino", "Columpio Asesino"],
    ["Los Lobos", "Lobos"],
    ["Las Odio", "Odio"],
  ]) {
    assert.equal(compareArtists(named(a!), named(b!)), "same", `${a} = ${b}`);
  }
});

test("an article is dropped only when another word follows, and only one", () => {
  assert.equal(compareArtists(named("The The"), named("The")), "same");
  assert.equal(compareArtists(named("The"), named("")), "different");
  assert.equal(compareArtists(named("De La Soul"), named("Soul")), "different");
  assert.equal(compareArtists(named("De La Soul"), named("La Soul")), "different");
});

test("indefinite articles stay part of the name", () => {
  assert.equal(compareArtists(named("A Perfect Circle"), named("Perfect Circle")), "different");
  assert.equal(compareArtists(named("An Albatross"), named("Albatross")), "different");
});

test("names made only of punctuation compare as written", () => {
  assert.equal(compareArtists(named("!!!"), named("!!!")), "same");
  assert.equal(compareArtists(named("!!!"), named("???")), "different");
});

test("ä ö ü ø å æ ß are letters of their own: a plain-letter or transliterated spelling is only possibly the same", () => {
  for (const [a, b] of [
    ["Die Ärzte", "Die Arzte"],
    ["Die Ärzte", "Die Aerzte"],
    ["Motörhead", "Motorhead"],
    ["Mötley Crüe", "Motley Crue"],
    ["Mötley Crüe", "Moetley Cruee"],
    ["Øresund", "Oresund"],
    ["Øresund", "Oeresund"],
    ["Århus", "Arhus"],
    ["Århus", "Aarhus"],
    ["Ænima", "Aenima"],
    ["Straße", "Strasse"],
  ]) {
    assert.equal(compareArtists(named(a!), named(b!)), "possibly", `${a} ~ ${b}`);
  }
  assert.equal(compareArtists(named("Øresund"), named("Öresund")), "possibly");
});

test("letters outside the folded accent marks keep names apart", () => {
  assert.equal(compareArtists(named("Mañana"), named("Manana")), "different");
  assert.equal(compareArtists(named("Ça"), named("Ca")), "different");
  assert.equal(compareArtists(named("Noël"), named("Noel")), "different");
  assert.equal(compareArtists(named("Blü"), named("Blau")), "different");
});

test("a real MusicBrainz ID decides when both sides have one", () => {
  assert.equal(compareArtists({ name: "Nirvana", mbid: MBID_A }, { name: "Nirvana", mbid: MBID_B }), "different");
  assert.equal(compareArtists({ name: "Motörhead", mbid: MBID_A }, { name: "Motorhead", mbid: MBID_A }), "same");
  assert.equal(compareArtists({ name: "Anything", mbid: MBID_A }, { name: "Else", mbid: ` ${MBID_A} ` }), "same");
});

test("a matching name with an ID on only one side is possibly the same artist", () => {
  assert.equal(compareArtists({ name: "Nirvana", mbid: MBID_A }, named("Nirvana")), "possibly");
  assert.equal(compareArtists(named("The Cure"), { name: "Cure", mbid: MBID_A }), "possibly");
  assert.equal(compareArtists({ name: "Nirvana", mbid: MBID_A }, named("Mudhoney")), "different");
});

test("a local saved-band ID counts as no ID", () => {
  assert.equal(compareArtists({ name: "Nirvana", mbid: "local-nirvana" }, named("Nirvana")), "same");
  assert.equal(compareArtists({ name: "Nirvana", mbid: "local-nirvana" }, { name: "Nirvana", mbid: MBID_A }), "possibly");
  assert.equal(compareArtists({ name: "Nirvana", mbid: "local-nirvana" }, { name: "Mudhoney", mbid: "local-nirvana" }), "different");
});

test("an artist is known by its canonical name as well as the name it was found under", () => {
  assert.equal(compareArtists({ name: "Alcest band", canonicalName: "Alcest" }, named("alcest")), "same");
  assert.equal(compareArtists(named("Alcest"), { name: "Alcest (FR)", canonicalName: "Alcést" }), "same");
});

test("isSameArtist accepts only the same artist; mayBeSameArtist also accepts a possible one", () => {
  const withId = { name: "Nirvana", mbid: MBID_A };
  assert.equal(isSameArtist(withId, named("Nirvana")), false);
  assert.equal(mayBeSameArtist(withId, named("Nirvana")), true);
  assert.equal(isSameArtist(named("The Cure"), named("cure")), true);
  assert.equal(mayBeSameArtist(named("Cure"), named("Mudhoney")), false);
});

test("foldArtistName gives one key for the spellings that name the same artist", () => {
  assert.equal(foldArtistName("The Cure"), foldArtistName("cure, the"));
  assert.equal(foldArtistName("Die Ärzte"), "ärzte");
  assert.notEqual(foldArtistName("Die Ärzte"), foldArtistName("Arzte"));
});

test("findArtist prefers the same artist, then the same spelling, then a possible match", () => {
  const arzte = { name: "Arzte" };
  const arzteWithId = { name: "Die Ärzte", mbid: MBID_A };
  const plain = { name: "Ärzte" };
  assert.equal(findArtist({ name: "Ärzte" }, [arzte, arzteWithId, plain]), plain);
  assert.equal(findArtist({ name: "Die Ärzte" }, [arzte, arzteWithId]), arzteWithId);
  assert.equal(findArtist({ name: "Aerzte" }, [arzteWithId]), arzteWithId);
  assert.equal(findArtist({ name: "Mudhoney" }, [arzte, arzteWithId]), undefined);
  assert.equal(findArtist({ name: "x", mbid: MBID_A }, [arzte, arzteWithId]), arzteWithId);
});

test("realMusicBrainzId drops blanks and local saved-band IDs", () => {
  assert.equal(realMusicBrainzId(` ${MBID_A} `), MBID_A);
  assert.equal(realMusicBrainzId("local-nirvana"), undefined);
  assert.equal(realMusicBrainzId("  "), undefined);
  assert.equal(realMusicBrainzId(null), undefined);
});
