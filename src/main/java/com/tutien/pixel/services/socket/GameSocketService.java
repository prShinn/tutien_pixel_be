package com.tutien.pixel.services.socket;

import org.springframework.stereotype.Service;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class GameSocketService {

//    private final Map<UUID, SessionInfo> sessions = new ConcurrentHashMap<>();
//
//    public void registerHandlers(SocketIOServer server) {
//
//        server.addConnectListener(client -> {
//            String token = client.getHandshakeData().getSingleUrlParam("token");
//            // verify JWT, set client data
//        });
//
//        server.addEventListener("join_world", JoinData.class, (client, data, ack) -> {
//            sessions.put(client.getSessionId(), new SessionInfo(client, data));
//            client.joinRoom("map:" + data.getMapId());
//            // gửi world_state cho client mới
//            List<SessionInfo> others = getPlayersOnMap(data.getMapId());
//            client.sendEvent("world_state", Map.of("players", others));
//            // notify others
//            client.getNamespace().getRoomOperations("map:" + data.getMapId())
//                    .sendEvent("player_join", sessions.get(client.getSessionId()));
//        });
//
//        server.addEventListener("move", MoveData.class, (client, data, ack) -> {
//            SessionInfo s = sessions.get(client.getSessionId());
//            if (s == null) return;
//            s.setX(data.getX()); s.setY(data.getY());
//            client.getNamespace().getRoomOperations("map:" + data.getMapId())
//                    .sendEvent("player_move", Map.of("id", client.getSessionId(), "x", data.getX(), "y", data.getY()));
//        });
//
//        // chat, attack_effect, map_change — tương tự socket.js hiện tại
//
//        server.addDisconnectListener(client -> {
//            SessionInfo s = sessions.remove(client.getSessionId());
//            if (s != null)
//                client.getNamespace().getRoomOperations("map:" + s.getMapId())
//                        .sendEvent("player_leave", Map.of("id", client.getSessionId()));
//        });
//    }
}