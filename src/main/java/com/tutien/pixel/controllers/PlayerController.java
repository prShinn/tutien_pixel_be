package com.tutien.pixel.controllers;

import com.tutien.pixel.entities.dtos.PlayerDto;
import com.tutien.pixel.entities.playerEntity;
import com.tutien.pixel.services.PlayerService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/player")
public class PlayerController {

    @Autowired
    private PlayerService service;

    @GetMapping
    public List<playerEntity> all() {
        return service.all();
    }

    @GetMapping("/old/{id}")
    public ResponseEntity<?> get(@PathVariable int id) {
        return ResponseEntity.of(service.get(id));
    }

    @GetMapping("/{id}")
    public PlayerDto getById(@PathVariable int id) {
        return service.getPlayerDto(id);
    }

    @GetMapping("/by-user/{id}")
    public ResponseEntity<?> getByUser(@PathVariable int id) {
        return ResponseEntity.of(service.getByUser(id));
    }

    @PostMapping("/pos")
    public void updatePos(@RequestBody playerEntity p) {
        service.updatePosition(p.getId(), p.getX(), p.getY(), p.getMapCode());
    }

    @PostMapping
    public playerEntity create(@RequestBody playerEntity e) {
        return service.create(e);
    }

    @PutMapping("/{id}")
    public playerEntity update(@PathVariable int id, @RequestBody playerEntity e) {
        return service.update(id, e);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable int id) {
        service.delete(id);
    }
}
