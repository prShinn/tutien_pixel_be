package com.tutien.pixel.services;

import com.tutien.pixel.entities.usersEntity;
import com.tutien.pixel.repositories.UserRepository;
import com.tutien.pixel.security.JwtUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
public class AuthService {

    @Autowired
    private UserRepository repo;
    @Autowired private JwtUtil jwt;
    public usersEntity register(usersEntity u) {
        if (repo.findByUsername(u.getUsername()).isPresent())
            throw new RuntimeException("Username exists");
        return repo.save(u);
    }

    //    public usersEntity login(String username, String password) {
//        usersEntity u = repo.findByUsername(username)
//                .orElseThrow(() -> new RuntimeException("User not found"));
//
//        if (!u.getPassword().equals(password))
//            throw new RuntimeException("Wrong password");
//
//        return u;
//    }
    public Map<String, Object> login(String username, String password) {
        usersEntity u = repo.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("User not found"));

        if (!u.getPassword().equals(password))
            throw new RuntimeException("Wrong password");

        String token = jwt.generateToken(username);

        return Map.of(
                "token", token,
//                "expired", 3600,
                "user", u
        );
    }
}
