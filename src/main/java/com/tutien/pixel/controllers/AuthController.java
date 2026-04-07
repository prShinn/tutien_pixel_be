package com.tutien.pixel.controllers;

import com.tutien.pixel.entities.dtos.LoginRequest;
import com.tutien.pixel.entities.usersEntity;
import com.tutien.pixel.services.AuthService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Autowired
    private AuthService auth;

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
}
