package com.tutien.pixel.controllers;

import com.tutien.pixel.entities.dtos.LoginRequest;
import com.tutien.pixel.entities.usersEntity;
import com.tutien.pixel.repositories.PlayerRepository;
import com.tutien.pixel.repositories.UserRepository;
import com.tutien.pixel.security.JwtUtil;
import com.tutien.pixel.services.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Autowired
    private AuthService auth;
    @Autowired
    private JwtUtil jwt;
    @Autowired
    private UserRepository userRepo;

    @PostMapping("/register")
    public usersEntity register(@RequestBody usersEntity u) {
        return auth.register(u);
    }
    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest req) {
        try {
            return ResponseEntity.ok(
                    auth.login(req.username, req.password)
            );
        } catch (Exception e) {
            return ResponseEntity.status(401).body(e.getMessage());
        }
    }
    @GetMapping("/me")
    public Map<String, Object> me(HttpServletRequest request) {

        String authHeader = request.getHeader("Authorization");

        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            throw new RuntimeException("Missing token");
        }

        String token = authHeader.substring(7);

        String username = jwt.getUsernameFromToken(token);

        usersEntity user = userRepo.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("User not found"));

        return Map.of(
                "user", user
        );
    }
}
