INSERT OR IGNORE INTO teams(fifa_code,name_ko,name_en,confederation,latitude,longitude) VALUES
('KOR','대한민국','Korea Republic','AFC',36.5,127.8),('JPN','일본','Japan','AFC',36.2,138.3),('AUS','호주','Australia','AFC',-25.3,133.8),('IRN','이란','Iran','AFC',32.4,53.7),('ARG','아르헨티나','Argentina','CONMEBOL',-38.4,-63.6),('BRA','브라질','Brazil','CONMEBOL',-14.2,-51.9),('FRA','프랑스','France','UEFA',46.2,2.2),('ENG','잉글랜드','England','UEFA',52.4,-1.2),('GER','독일','Germany','UEFA',51.2,10.4),('USA','미국','USA','CONCACAF',37.1,-95.7),('MEX','멕시코','Mexico','CONCACAF',23.6,-102.5),('MAR','모로코','Morocco','CAF',31.8,-7.1),('COL','콜롬비아','Colombia','CONMEBOL',4.6,-74.3),('TUN','튀니지','Tunisia','CAF',33.9,9.5),('JOR','요르단','Jordan','AFC',30.6,36.2);
INSERT OR IGNORE INTO rankings(team_id,release_date,rank,points,previous_rank,source_url) SELECT id,'2026-06-11',23,1585.2,22,'demo' FROM teams WHERE fifa_code='KOR';
INSERT OR IGNORE INTO rankings(team_id,release_date,rank,points,previous_rank,source_url) SELECT id,'2026-06-11',18,1642.1,19,'demo' FROM teams WHERE fifa_code='JPN';
INSERT OR IGNORE INTO rankings(team_id,release_date,rank,points,previous_rank,source_url) SELECT id,'2026-06-11',1,1888.4,2,'demo' FROM teams WHERE fifa_code='FRA';
INSERT OR IGNORE INTO rankings(team_id,release_date,rank,points,previous_rank,source_url) SELECT id,'2026-06-11',2,1881.9,1,'demo' FROM teams WHERE fifa_code='ARG';
INSERT OR IGNORE INTO rankings(team_id,release_date,rank,points,previous_rank,source_url) SELECT id,'2026-06-11',4,1775.8,4,'demo' FROM teams WHERE fifa_code='BRA';
INSERT OR IGNORE INTO rankings(team_id,release_date,rank,points,previous_rank,source_url) SELECT id,'2026-06-11',8,1732.2,8,'demo' FROM teams WHERE fifa_code='ENG';
INSERT OR IGNORE INTO matches(external_id,match_date,home_team_id,away_team_id,home_score,away_score,competition,stage,importance,neutral,source_url)
SELECT 'd1','2023-03-24',a.id,b.id,2,2,'Friendly','Friendly',10,0,'demo' FROM teams a,teams b WHERE a.fifa_code='KOR' AND b.fifa_code='COL';
INSERT OR IGNORE INTO matches(external_id,match_date,home_team_id,away_team_id,home_score,away_score,competition,stage,importance,neutral,source_url)
SELECT 'd2','2023-10-13',a.id,b.id,4,0,'Friendly','Friendly',10,0,'demo' FROM teams a,teams b WHERE a.fifa_code='KOR' AND b.fifa_code='TUN';
INSERT OR IGNORE INTO matches(external_id,match_date,home_team_id,away_team_id,home_score,away_score,competition,stage,importance,neutral,source_url)
SELECT 'd3','2024-02-02',a.id,b.id,1,2,'AFC Asian Cup','Quarter-final',35,1,'demo' FROM teams a,teams b WHERE a.fifa_code='AUS' AND b.fifa_code='KOR';
INSERT OR IGNORE INTO matches(external_id,match_date,home_team_id,away_team_id,home_score,away_score,competition,stage,importance,neutral,source_url)
SELECT 'd4','2024-02-07',a.id,b.id,2,0,'AFC Asian Cup','Semi-final',35,1,'demo' FROM teams a,teams b WHERE a.fifa_code='JOR' AND b.fifa_code='KOR';
INSERT OR IGNORE INTO matches(external_id,match_date,home_team_id,away_team_id,home_score,away_score,competition,stage,importance,neutral,source_url)
SELECT 'd5','2022-12-18',a.id,b.id,3,3,'FIFA World Cup','Final',60,1,'demo' FROM teams a,teams b WHERE a.fifa_code='ARG' AND b.fifa_code='FRA';
