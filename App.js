
import React, { useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  RefreshControl
} from "react-native";

const API = "https://fantasy.premierleague.com/api/";
const BUDGET = 1000;
const REFRESH_TIME = 15 * 60 * 1000;

const POSITIONS = {
  1: "GK",
  2: "DEF",
  3: "MID",
  4: "FWD"
};

const SQUAD_SLOTS = [
  1, 1,
  2, 2, 2, 2, 2,
  3, 3, 3, 3, 3,
  4, 4, 4
];

function predictPoints(p) {
  const form = Number(p.form) || 0;
  const ppg = Number(p.points_per_game) || 0;
  const ict = Number(p.ict_index) || 0;
  const xgi = Number(p.expected_goal_involvements) || 0;
  const minutes = Number(p.minutes) || 0;

  const availability =
    p.status === "a" ? 1 :
    p.status === "d" ? 0.65 :
    p.status === "i" || p.status === "s" ? 0.1 :
    0.5;

  const playingChance =
    p.chance_of_playing_next_round == null
      ? 1
      : p.chance_of_playing_next_round / 100;

  const minutesFactor = Math.min(minutes / 900, 1);

  let score =
    ppg * 0.40 +
    form * 0.30 +
    (xgi / 5) * 0.20 +
    (ict / 100) * 0.10;

  score *= (0.65 + minutesFactor * 0.35);
  score *= availability * playingChance;

  return Math.max(0, Number(score.toFixed(2)));
}

function optimizeSquad(players) {
  let beam = [{
    picks: [],
    cost: 0,
    score: 0,
    clubs: {}
  }];

  for (const position of SQUAD_SLOTS) {
    const candidates = players
      .filter(p => p.element_type === position)
      .sort((a, b) => b.predictedPoints - a.predictedPoints)
      .slice(0, 100);

    const next = [];

    for (const state of beam) {
      for (const p of candidates) {
        if (state.picks.some(x => x.id === p.id)) continue;

        const cost = Number(p.now_cost) || 0;
        if (state.cost + cost > BUDGET) continue;

        const clubCount = state.clubs[p.team] || 0;
        if (clubCount >= 3) continue;

        const clubs = {
          ...state.clubs,
          [p.team]: clubCount + 1
        };

        next.push({
          picks: [...state.picks, p],
          cost: state.cost + cost,
          score: state.score + p.predictedPoints,
          clubs
        });
      }
    }

    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, 100);

    if (!beam.length) return [];
  }

  return beam[0].picks;
}

export default function App() {
  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState({});
  const [squad, setSquad] = useState([]);
  const [fixtures, setFixtures] = useState([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  async function loadData(isRefresh = false) {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      setError("");

      const response = await fetch(API + "bootstrap-static/");

      if (!response.ok) {
        throw new Error("تعذر الاتصال بخادم Fantasy Premier League");
      }

      const data = await response.json();

      const teamMap = {};
      data.teams.forEach(t => {
        teamMap[t.id] = t.name;
      });

      const enriched = data.elements.map(p => ({
        ...p,
        predictedPoints: predictPoints(p)
      }));

      setPlayers(enriched);
      setTeams(teamMap);

      const bestSquad = optimizeSquad(enriched);
      setSquad(bestSquad);

      try {
        const fixtureResponse = await fetch(API + "fixtures/");
        if (fixtureResponse.ok) {
          const fixtureData = await fixtureResponse.json();
          setFixtures(fixtureData.filter(f => !f.finished).slice(0, 20));
        }
      } catch (e) {
        console.log("Fixtures unavailable", e);
      }

      setUpdated(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e.message || "حدث خطأ أثناء تحميل البيانات");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadData();

    const timer = setInterval(() => {
      loadData(true);
    }, REFRESH_TIME);

    return () => clearInterval(timer);
  }, []);

  const totalCost = squad.reduce(
    (sum, p) => sum + Number(p.now_cost || 0),
    0
  );

  const totalPoints = squad.reduce(
    (sum, p) => sum + p.predictedPoints,
    0
  );

  const filteredPlayers = players
    .filter(p => {
      const name = `${p.first_name} ${p.second_name}`.toLowerCase();
      const matchesSearch = name.includes(search.toLowerCase());
      const matchesPosition =
        filter === "ALL" || POSITIONS[p.element_type] === filter;
      return matchesSearch && matchesPosition;
    })
    .sort((a, b) => b.predictedPoints - a.predictedPoints)
    .slice(0, 50);

  const bestCaptain = [...squad]
    .sort((a, b) => b.predictedPoints - a.predictedPoints)[0];

  const bestVice = [...squad]
    .filter(p => p.id !== bestCaptain?.id)
    .sort((a, b) => b.predictedPoints - a.predictedPoints)[0];

  function PlayerCard({ player, index }) {
    const name = `${player.first_name} ${player.second_name}`;

    return (
      <TouchableOpacity
        style={styles.playerCard}
        onPress={() => setSelectedPlayer(
          selectedPlayer?.id === player.id ? null : player
        )}
      >
        <View style={styles.playerNumber}>
          <Text style={styles.numberText}>{index + 1}</Text>
        </View>

        <View style={styles.playerInfo}>
          <Text style={styles.playerName}>{name}</Text>
          <Text style={styles.muted}>
            {teams[player.team] || "Unknown"} · {POSITIONS[player.element_type]}
          </Text>
          {selectedPlayer?.id === player.id && (
            <View style={styles.details}>
              <Text style={styles.muted}>Form: {player.form}</Text>
              <Text style={styles.muted}>PPG: {player.points_per_game}</Text>
              <Text style={styles.muted}>Minutes: {player.minutes}</Text>
              <Text style={styles.muted}>ICT: {player.ict_index}</Text>
              <Text style={styles.muted}>
                xGI: {player.expected_goal_involvements}
              </Text>
              <Text style={styles.muted}>
                Status: {player.status}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.playerStats}>
          <Text style={styles.points}>
            {player.predictedPoints.toFixed(1)}
          </Text>
          <Text style={styles.muted}>
            £{(player.now_cost / 10).toFixed(1)}m
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#19d89b" />
        <Text style={styles.loadingText}>Fantasy AI</Text>
        <Text style={styles.muted}>جاري تحميل بيانات اللاعبين...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadData(true)}
            tintColor="#19d89b"
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.logo}>FANTASY AI</Text>
          <Text style={styles.subtitle}>مدير فريقك الذكي</Text>
          <Text style={styles.updated}>
            آخر تحديث: {updated || "--"}
          </Text>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => loadData()}
            >
              <Text style={styles.buttonText}>إعادة المحاولة</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{players.length}</Text>
            <Text style={styles.statLabel}>اللاعبون</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{squad.length}/15</Text>
            <Text style={styles.statLabel}>التشكيلة</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>
              {(totalCost / 10).toFixed(1)}
            </Text>
            <Text style={styles.statLabel}>الميزانية المستخدمة</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>🏆 تشكيلتك المقترحة</Text>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>مجموع النقاط التقديري</Text>
          <Text style={styles.bigPoints}>{totalPoints.toFixed(1)}</Text>
          <Text style={styles.muted}>
            تكلفة الفريق: £{(totalCost / 10).toFixed(1)}m
          </Text>
          <Text style={styles.muted}>
            المتبقي: £{((BUDGET - totalCost) / 10).toFixed(1)}m
          </Text>
        </View>

        {squad.length > 0 ? (
          <>
            <View style={styles.captainBox}>
              <Text style={styles.captainTitle}>⭐ الكابتن المقترح</Text>
              <Text style={styles.playerName}>
                {bestCaptain?.first_name} {bestCaptain?.second_name}
              </Text>
              <Text style={styles.muted}>
                النقاط المتوقعة: {bestCaptain?.predictedPoints}
              </Text>
              <Text style={styles.captainTitle}>نائب الكابتن</Text>
              <Text style={styles.playerName}>
                {bestVice?.first_name} {bestVice?.second_name}
              </Text>
            </View>

            <Text style={styles.sectionTitle}>قائمة الفريق (15 لاعباً)</Text>
            {squad.map((p, i) => (
              <PlayerCard key={p.id} player={p} index={i} />
            ))}
          </>
        ) : (
          <Text style={styles.muted}>
            لم نتمكن من تكوين تشكيلة كاملة ضمن الميزانية.
          </Text>
        )}

        <Text style={styles.sectionTitle}>🔎 البحث عن لاعب</Text>

        <TextInput
          style={styles.searchInput}
          placeholder="اكتب اسم اللاعب..."
          placeholderTextColor="#89939e"
          value={search}
          onChangeText={setSearch}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {["ALL", "GK", "DEF", "MID", "FWD"].map(pos => (
            <TouchableOpacity
              key={pos}
              style={[
                styles.filterButton,
                filter === pos && styles.activeFilter
              ]}
              onPress={() => setFilter(pos)}
            >
              <Text style={styles.buttonText}>{pos}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {filteredPlayers.map((p, i) => (
          <PlayerCard key={p.id} player={p} index={i} />
        ))}

        <Text style={styles.sectionTitle}>📅 المباريات القادمة</Text>

        {fixtures.length === 0 ? (
          <Text style={styles.muted}>لا توجد مباريات متاحة حالياً.</Text>
        ) : (
          fixtures.map(f => (
            <View key={f.id} style={styles.fixtureCard}>
              <Text style={styles.fixtureText}>
                {teams[f.team_h] || "Home"}  VS  {teams[f.team_a] || "Away"}
              </Text>
              <Text style={styles.muted}>
                {f.event ? `Gameweek ${f.event}` : "موعد غير محدد"}
              </Text>
              <Text style={styles.muted}>
                صعوبة الأرض: {f.team_h_difficulty} · صعوبة الخارج: {f.team_a_difficulty}
              </Text>
            </View>
          ))
        )}

        <View style={styles.footer}>
          <Text style={styles.muted}>
            Fantasy AI · البيانات من Fantasy Premier League
          </Text>
          <Text style={styles.disclaimer}>
            التوقعات تقديرية وليست ضماناً للنقاط أو النتائج.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#07131f"
  },
  center: {
    flex: 1,
    backgroundColor: "#07131f",
    justifyContent: "center",
    alignItems: "center"
  },
  header: {
    padding: 24,
    alignItems: "center",
    backgroundColor: "#102b38"
  },
  logo: {
    fontSize: 30,
    fontWeight: "900",
    color: "#19d89b"
  },
  subtitle: {
    color: "#ffffff",
    fontSize: 16,
    marginTop: 5
  },
  updated: {
    color: "#9aaeb9",
    fontSize: 11,
    marginTop: 10
  },
  loadingText: {
    color: "#19d89b",
    fontSize: 24,
    fontWeight: "bold",
    margin: 15
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    margin: 12
  },
  statBox: {
    flex: 1,
    margin: 4,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#132a38",
    alignItems: "center"
  },
  statValue: {
    color: "#19d89b",
    fontSize: 21,
    fontWeight: "bold"
  },
  statLabel: {
    color: "#a9bbc4",
    fontSize: 11,
    marginTop: 5
  },
  sectionTitle: {
    color: "#ffffff",
    fontSize: 19,
    fontWeight: "bold",
    marginHorizontal: 16,
    marginTop: 25,
    marginBottom: 12
  },
  summaryCard: {
    backgroundColor: "#123b37",
    marginHorizontal: 14,
    padding: 20,
    borderRadius: 15,
    alignItems: "center"
  },
  summaryLabel: {
    color: "#b7dcd0",
    fontSize: 14
  },
  bigPoints: {
    color: "#19d89b",
    fontSize: 40,
    fontWeight: "bold",
    margin: 8
  },
  muted: {
    color: "#9aabb7",
    fontSize: 12,
    marginTop: 3
  },
  playerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#132735",
    marginHorizontal: 12,
    marginVertical: 4,
    padding: 12,
    borderRadius: 10
  },
  playerNumber: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#1a5548",
    justifyContent: "center",
    alignItems: "center"
  },
  numberText: {
    color: "#19d89b",
    fontWeight: "bold"
  },
  playerInfo: {
    flex: 1,
    marginLeft: 10
  },
  playerName: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "bold"
  },
  playerStats: {
    alignItems: "flex-end"
  },
  points: {
    color: "#19d89b",
    fontSize: 19,
    fontWeight: "bold"
  },
  details: {
    marginTop: 8
  },
  captainBox: {
    backgroundColor: "#172f3c",
    margin: 12,
    padding: 16,
    borderRadius: 12
  },
  captainTitle: {
    color: "#19d89b",
    fontWeight: "bold",
    marginBottom: 8,
    marginTop: 5
  },
  searchInput: {
    backgroundColor: "#132735",
    color: "#ffffff",
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 14,
    borderRadius: 10
  },
  filterButton: {
    backgroundColor: "#203543",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    marginHorizontal: 5
  },
  activeFilter: {
    backgroundColor: "#087b5a"
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "bold"
  },
  fixtureCard: {
    backgroundColor: "#132735",
    padding: 14,
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 10
  },
  fixtureText: {
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 15
  },
  errorBox: {
    backgroundColor: "#522b32",
    margin: 12,
    padding: 15,
    borderRadius: 10
  },
  errorText: {
    color: "#ffffff"
  },
  retryButton: {
    backgroundColor: "#087b5a",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10
  },
  footer: {
    padding: 25,
    alignItems: "center"
  },
  disclaimer: {
    color: "#71828c",
    fontSize: 10,
    marginTop: 8,
    textAlign: "center"
  }
});
