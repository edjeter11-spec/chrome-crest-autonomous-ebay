// Static Wikipedia Commons thumbnails per driver. Avoids a backend round-trip.
// If a name isn't here, <img> falls back to initials on error.
const PHOTOS = {
  // 2025 F1 grid
  'Max Verstappen': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Max_Verstappen_2017_Malaysia_3.jpg/330px-Max_Verstappen_2017_Malaysia_3.jpg',
  'Lewis Hamilton': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/Lewis_Hamilton_2016_Malaysia_2.jpg/330px-Lewis_Hamilton_2016_Malaysia_2.jpg',
  'Charles Leclerc': 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/Charles_Leclerc_2022_Imola.jpg/330px-Charles_Leclerc_2022_Imola.jpg',
  'Lando Norris': 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Lando_Norris_2022_Imola.jpg/330px-Lando_Norris_2022_Imola.jpg',
  'Fernando Alonso': 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Fernando_Alonso_2016_Malaysia_2.jpg/330px-Fernando_Alonso_2016_Malaysia_2.jpg',
  'Oscar Piastri': 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Oscar_Piastri_2023_Imola.jpg/330px-Oscar_Piastri_2023_Imola.jpg',
  'Carlos Sainz': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Carlos_Sainz_Jr_2016_Malaysia_2.jpg/330px-Carlos_Sainz_Jr_2016_Malaysia_2.jpg',
  'George Russell': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/George_Russell_2021_British_GP.jpg/330px-George_Russell_2021_British_GP.jpg',
  'Sergio Perez': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Sergio_P%C3%A9rez_2016_Malaysia_2.jpg/330px-Sergio_P%C3%A9rez_2016_Malaysia_2.jpg',
  'Lance Stroll': 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Lance_Stroll_2022_Imola.jpg/330px-Lance_Stroll_2022_Imola.jpg',
  'Valtteri Bottas': 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/77/Valtteri_Bottas_2017_Malaysia_1.jpg/330px-Valtteri_Bottas_2017_Malaysia_1.jpg',
  'Esteban Ocon': 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/76/Esteban_Ocon_2018_Canada.jpg/330px-Esteban_Ocon_2018_Canada.jpg',
  'Pierre Gasly': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Pierre_Gasly_2019_Austria.jpg/330px-Pierre_Gasly_2019_Austria.jpg',
  'Yuki Tsunoda': 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Yuki_Tsunoda_2022_Imola.jpg/330px-Yuki_Tsunoda_2022_Imola.jpg',
  'Daniel Ricciardo': 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Daniel_Ricciardo_2017_Malaysia_1.jpg/330px-Daniel_Ricciardo_2017_Malaysia_1.jpg',
  'Nico Hulkenberg': 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Nico_H%C3%BClkenberg_2017_Malaysia.jpg/330px-Nico_H%C3%BClkenberg_2017_Malaysia.jpg',
  'Kevin Magnussen': 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Kevin_Magnussen_2017_Malaysia_3.jpg/330px-Kevin_Magnussen_2017_Malaysia_3.jpg',
  'Zhou Guanyu': 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Zhou_Guanyu_2022_Imola.jpg/330px-Zhou_Guanyu_2022_Imola.jpg',
  'Alexander Albon': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/Alex_Albon_2019_Austria.jpg/330px-Alex_Albon_2019_Austria.jpg',
  'Logan Sargeant': 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/77/Logan_Sargeant_2023_Imola.jpg/330px-Logan_Sargeant_2023_Imola.jpg',
  'Oliver Bearman': 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/af/FIA_F1_Austria_2024_Nr._38_Bearman.jpg/330px-FIA_F1_Austria_2024_Nr._38_Bearman.jpg',
  'Jack Doohan': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Jack_Doohan_2022_F2.jpg/330px-Jack_Doohan_2022_F2.jpg',
  'Andrea Kimi Antonelli': 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/FIA_F1_Austria_2024_Nr._12_Antonelli.jpg/330px-FIA_F1_Austria_2024_Nr._12_Antonelli.jpg',
  'Isack Hadjar': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Isack_Hadjar_2024.jpg/330px-Isack_Hadjar_2024.jpg',
  'Gabriel Bortoleto': 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/Gabriel_Bortoleto_2024.jpg/330px-Gabriel_Bortoleto_2024.jpg',
  'Liam Lawson': 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Liam_Lawson_2023.jpg/330px-Liam_Lawson_2023.jpg',
  'Franco Colapinto': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Franco_Colapinto_2024.jpg/330px-Franco_Colapinto_2024.jpg',

  // Legends
  'Michael Schumacher': 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Michael_Schumacher_2010_Malaysia_3rd_free_practice.jpg/330px-Michael_Schumacher_2010_Malaysia_3rd_free_practice.jpg',
  'Ayrton Senna': 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Ayrton_Senna_1992_Monaco.jpg/330px-Ayrton_Senna_1992_Monaco.jpg',
  'Alain Prost': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c0/Alain_Prost_1987_USA.jpg/330px-Alain_Prost_1987_USA.jpg',
  'Nigel Mansell': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Nigel_Mansell_1991.jpg/330px-Nigel_Mansell_1991.jpg',
  'Mario Andretti': 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Mario_Andretti_1978.jpg/330px-Mario_Andretti_1978.jpg',
  'Mika Hakkinen': 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Mika_H%C3%A4kkinen_2001_Canada.jpg/330px-Mika_H%C3%A4kkinen_2001_Canada.jpg',
  'Damon Hill': 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Damon_Hill_1996.jpg/330px-Damon_Hill_1996.jpg',
  'Jacques Villeneuve': 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Jacques_Villeneuve_1996.jpg/330px-Jacques_Villeneuve_1996.jpg',
  'Emerson Fittipaldi': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Emerson_Fittipaldi_1973.jpg/330px-Emerson_Fittipaldi_1973.jpg',
  'Juan Pablo Montoya': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Juan_Pablo_Montoya_2005.jpg/330px-Juan_Pablo_Montoya_2005.jpg',
  'Gerhard Berger': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Gerhard_Berger_1991.jpg/330px-Gerhard_Berger_1991.jpg',
  'James Hunt': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/James_Hunt_1976.jpg/330px-James_Hunt_1976.jpg',
  'Sebastian Vettel': 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Sebastian_Vettel_2022_Imola.jpg/330px-Sebastian_Vettel_2022_Imola.jpg',
  'Kimi Raikkonen': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1c/Kimi_R%C3%A4ikk%C3%B6nen_2017_Malaysia_1.jpg/330px-Kimi_R%C3%A4ikk%C3%B6nen_2017_Malaysia_1.jpg',
  'Niki Lauda': 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Niki_Lauda_1984.jpg/330px-Niki_Lauda_1984.jpg',
  'Jackie Stewart': 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/Jackie_Stewart_1973.jpg/330px-Jackie_Stewart_1973.jpg',
  'Jim Clark': 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Jim_Clark_1965_Nurburgring.jpg/330px-Jim_Clark_1965_Nurburgring.jpg',
  'Stirling Moss': 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Stirling_Moss_1958.jpg/330px-Stirling_Moss_1958.jpg',
}

export function driverPhoto(name) {
  return PHOTOS[name] || ''
}

export function driverInitials(name) {
  return (name || '').split(' ').map(n => n[0]).filter(Boolean).join('').slice(0, 2)
}
